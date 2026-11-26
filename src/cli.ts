#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseArgs } from './cli-options.js';
import { loadConfig } from './config.js';
import { summarizeRun, screenshotNotice, type ScreenshotPolicy } from './report.js';
import { writeReports } from './report-writer.js';
import { runAudit } from './runner.js';
import { auditComponents } from './components/audit.js';
import { writeComponentReports } from './components/reports.js';
import { validateSourcePaths } from './components/source.js';
import type { HarnessConfig } from './types.js';
import { discoverLibrary } from './library/discovery.js';
import { prepareComponentPlan, syncComponentPlan } from './library/workflow.js';
import { describeError, runSourceCommand, SOURCE_COMMANDS } from './check-cli.js';
import { registerExportedScreenshots, registerHistoricalScreenshots, screenshotRegistry } from './ui/exported-screenshot-retention.js';
import { cleanExpiredScreenshots } from './ui/screenshot-retention.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if(argv[0]==='requirements'){
    const usage='uxqa requirements --file <requirements.md|document.txt>\n输出带原文位置的候选条款 JSON。导入项目、人工绑定和运行验收任务请使用 uxqa ui 或桌面应用。 / Inspect a document without a model. Import and bind acceptance tasks in the console.';
    if(argv.includes('--help')||argv.includes('-h')){console.log(usage);return;}
    if(argv.length!==3||argv[1]!=='--file')throw Error(usage);
    const {inspectRequirements}=await import('./requirement-drafts.js');
    console.log(JSON.stringify(await inspectRequirements(resolve(argv[2])),null,2));return;
  }
  if (argv[0] === 'figma') {
    const { runFigmaCommand } = await import('./figma/cli.js');
    process.exitCode = await runFigmaCommand(argv.slice(1));
    return;
  }
  if (SOURCE_COMMANDS.has(argv[0])) {
    try {
      const stdin = argv[0] === 'hook' && argv[1] === 'claude' ? await readStdin() : '';
      process.exitCode = await runSourceCommand(argv, { stdin });
    } catch (error) {
      const { message, code } = describeError(error);
      console.error(message);
      process.exitCode = code;
    }
    return;
  }
  if (argv[0] === 'browser') {
    const { runBrowserCommand } = await import('./browser/cli.js');
    process.exitCode = await runBrowserCommand(argv.slice(1));
    return;
  }
  const args = parseArgs(argv);
  if (args.help) {
    if (argv[0]==='run') {
      console.log('uxqa run (--url <page> | --config <scenario.json>) [--out <directory>] [--headed]\n'+
        'Run checks against a reachable web page. Relative routes use baseUrl.\n'+
        'Example config: {"baseUrl":"http://localhost:3000","routes":["/","/settings"],"viewports":[{"name":"desktop","width":1440,"height":900}]}\n'+
        'For a PRD use uxqa requirements --file <document.md>. Use uxqa ui or Desktop to import, bind and run acceptance tasks, or capture a login session. Supply storageState in scenario JSON.\n'+
        'Add flows for interactions, requirementChecks for source-backed checks, or journeys for cross-role comparisons. Explicit --out keeps screenshots unless --expire-screenshots is set.');return;
    }
    if (argv[0]==='components') {
      console.log('uxqa components [--url <page> | --config <scenario.json>] [--source <directory>] [--library <directory>] [--selector <css>] [--out <directory>] [--headed] [--no-design-tokens]\n'+
        'Use a page, source files, or both. --library selects a catalog under --source. For cross-page observations configure multiple routes. With --out, use --expire-screenshots only to register screenshots for cleanup.');return;
    }
    if (argv[0]==='library') {
      console.log('uxqa library --source <project-directory> [--library <directory>] [--out <directory>]\n'+
        'Discover component catalogs in the project and report their sources. Example: uxqa library --source .');return;
    }
    console.log('Usage:\n  uxqa requirements --file <document.md>   (inspect source clauses)\n  uxqa ui   (import documents, bind acceptance tasks, capture login state; also available in Desktop)\n  uxqa figma prepare | ingest | check | graph\n  uxqa check | inventory | find | hook | mcp   (source rules; see uxqa check --help)\n  uxqa browser [install]   (the screenshot browser; downloaded only after you agree)\n  uxqa run --url <url> [--config <file>] [--out <empty-dir>] [--headed]\n  uxqa components [--url <url> | --config <file>] [--source <directory>] [--library <directory>] [--selector <css>] [--no-design-tokens]\n  uxqa library --source <directory> [--library <directory>]\n  uxqa component-plan --source <directory> --definition <json> [--library <directory>]\n  uxqa component-sync --plan <component-plan.json> [--out <empty-dir>]');
    return;
  }
  const runId = `${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
  const outDir = args.out ? resolve(args.out) : resolve(process.env.UXQA_OUTPUT_ROOT ?? 'artifacts',runId);
  const policy:ScreenshotPolicy=args.out&&!args.expireScreenshots?'user-export':'managed-48h';
  async function finishScreenshots(paths:string[]){
    if(!paths.length)return;
    if(policy==='managed-48h'){
      try{await registerExportedScreenshots(outDir,paths);}
      catch(error){console.error('Screenshot registration failed: '+(error instanceof Error?error.message:String(error)));return;}
      console.log(screenshotNotice(policy)+' '+screenshotRegistry()+' · Keep exports: use --out <directory> without --expire-screenshots.');
    }else console.log(screenshotNotice(policy)+' '+outDir);
  }
  if (args.command === 'run' || args.command === 'components') {
    try { await registerHistoricalScreenshots(resolve(process.env.UXQA_OUTPUT_ROOT ?? 'artifacts')); await cleanExpiredScreenshots(); }
    catch (error) { console.error(`Screenshot cleanup failed; it will be retried: ${error instanceof Error ? error.message : String(error)}`); }
  }
  let config: HarnessConfig | undefined;
  if (args.url || args.config) {
    if(args.config && /\.(?:md|markdown|txt)$/i.test(args.config))throw Error('需求文档请使用 uxqa requirements --file <document.md>。在 uxqa ui 或桌面端导入文档并绑定验收任务。 / --config expects scenario JSON.');
    let raw: unknown = args.config ? JSON.parse(await readFile(resolve(args.config),'utf8')) : {baseUrl:args.url};
    if (args.url && args.config && raw && typeof raw === 'object' && !Array.isArray(raw)) raw = {...raw,baseUrl:args.url};
    config = loadConfig(raw);
    const configDir = args.config ? dirname(resolve(args.config)) : process.cwd();
    if (config.storageState && !isAbsolute(config.storageState)) config.storageState = resolve(configDir,config.storageState);
    if (config.actorStates) config.actorStates = Object.fromEntries(Object.entries(config.actorStates).map(([actor, path]) => [actor, resolve(configDir, path)]));
    if (config.evidence.productRoot && !isAbsolute(config.evidence.productRoot)) config.evidence.productRoot = resolve(configDir,config.evidence.productRoot);
  }
  if (args.source) await validateSourcePaths(args.source,outDir);
  const existing = await readdir(outDir).catch((error: NodeJS.ErrnoException) => { if (error.code==='ENOENT') return []; throw error; });
  if (existing.length) throw new Error('Output directory is not empty; select a new directory to preserve existing evidence');
  await mkdir(outDir,{recursive:true,mode:0o700});
  if (args.command==='library') {
    const result=await discoverLibrary(args.source!,args.library);
    const path=resolve(outDir,'library.json');
    await writeFile(path,JSON.stringify(result,null,2),{mode:0o600});
    console.log(`Product: ${result.productId}\nLibrary: ${result.status}\n${result.library?.root ?? 'No unique supported library selected'}\nJSON: ${path}`);
    if (result.status!=='found') process.exitCode=1;
    return;
  }
  if (args.command==='component-plan') {
    const result=await prepareComponentPlan({source:args.source!,definitionPath:args.definition!,libraryPath:args.library,outDir});
    console.log(`Library bound: ${result.plan.library.root}\nReady for componentization: ${result.path}`);
    return;
  }
  if (args.command==='component-sync') {
    const result=await syncComponentPlan(args.plan!,outDir);
    console.log(`Component ${result.status}: ${result.productId}\nCatalog: ${result.catalog}\nSpecification: ${result.specification}\nReceipt: ${result.receipt}`);
    return;
  }
  if (args.command === 'components') {
    const result = await auditComponents(config,{outDir,headed:args.headed,sourceDir:args.source,selector:args.selector,designTokens:args.designTokens,libraryDir:args.library});
    await finishScreenshots(result.observations.flatMap(item=>item.screenshot?[item.screenshot]:[]));
    const reports = await writeComponentReports(result,outDir,policy);
    console.log(`Component audit ${result.status}: ${result.candidates.length} cross-page candidates, ${result.source?.duplicates.length ?? 0} source clone pairs`);
    console.log(`HTML: ${reports.htmlPath}\nJSON: ${reports.jsonPath}\nMarkdown: ${reports.markdownPath}`);
    if (result.status==='partial') process.exitCode = 1;
    return;
  }
  const result = await runAudit(config!, { outDir, headed: args.headed,onDiagnostic:message=>console.error(message) });
  await finishScreenshots(result.artifacts.filter(path=>path.toLowerCase().endsWith('.png')));
  const reports = await writeReports(result, outDir,policy);
  const summary = summarizeRun(result);
  console.log(`QA Master ${summary.status}: ${summary.blocking} blocking, ${summary.informational} informational`);
  console.log(`Verdict: ${summary.verdict} (pass ${summary.checks.pass}, fail ${summary.checks.fail}, blocked ${summary.checks.blocked}, not verified ${summary.checks['not-verified']}, not applicable ${summary.checks['not-applicable']})`);
  console.log(`JSON: ${reports.jsonPath}`);
  console.log(`Markdown: ${reports.markdownPath}`);
  if (summary.status === 'failed' || summary.verdict === 'fail' || summary.verdict === 'blocked') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
