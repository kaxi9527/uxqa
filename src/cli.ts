#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseArgs } from './cli-options.js';
import { loadConfig } from './config.js';
import { summarizeRun } from './report.js';
import { writeReports } from './report-writer.js';
import { runAudit } from './runner.js';
import { auditComponents } from './components/audit.js';
import { writeComponentReports } from './components/reports.js';
import { validateSourcePaths } from './components/source.js';
import type { HarnessConfig } from './types.js';
import { discoverLibrary } from './library/discovery.js';
import { prepareComponentPlan, syncComponentPlan } from './library/workflow.js';
import { describeError, runSourceCommand, SOURCE_COMMANDS } from './check-cli.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
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
    console.log('  uxqa figma prepare --config <figma.json> | figma check --input <capture-directory>');
    console.log('Usage:\n  uxqa ui | check | inventory | find | hook | mcp   (source rules; see uxqa check --help)\n  uxqa browser [install]   (the screenshot browser; downloaded only after you agree)\n  uxqa run --url <url> [--config <file>] [--out <empty-dir>] [--headed]\n  uxqa components [--url <url> | --config <file>] [--source <directory>] [--library <directory>] [--selector <css>] [--no-design-tokens]\n  uxqa library --source <directory> [--library <directory>]\n  uxqa component-plan --source <directory> --definition <json> [--library <directory>]\n  uxqa component-sync --plan <component-plan.json> [--out <empty-dir>]');
    return;
  }
  const runId = `${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
  const outDir = args.out ? resolve(args.out) : resolve(process.env.UXQA_OUTPUT_ROOT ?? 'artifacts',runId);
  let config: HarnessConfig | undefined;
  if (args.url || args.config) {
    let raw: unknown = args.config ? JSON.parse(await readFile(resolve(args.config),'utf8')) : {baseUrl:args.url};
    if (args.url && args.config && raw && typeof raw === 'object' && !Array.isArray(raw)) raw = {...raw,baseUrl:args.url};
    config = loadConfig(raw);
    const configDir = args.config ? dirname(resolve(args.config)) : process.cwd();
    if (config.storageState && !isAbsolute(config.storageState)) config.storageState = resolve(configDir,config.storageState);
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
    const reports = await writeComponentReports(result,outDir);
    console.log(`Component audit ${result.status}: ${result.candidates.length} cross-page candidates, ${result.source?.duplicates.length ?? 0} source clone pairs`);
    console.log(`HTML: ${reports.htmlPath}\nJSON: ${reports.jsonPath}\nMarkdown: ${reports.markdownPath}`);
    if (result.status==='partial') process.exitCode = 1;
    return;
  }
  const result = await runAudit(config!, { outDir, headed: args.headed });
  const reports = await writeReports(result, outDir);
  const summary = summarizeRun(result);
  console.log(`UXQA ${summary.status}: ${summary.blocking} blocking, ${summary.informational} informational`);
  console.log(`Verdict: ${summary.verdict} (pass ${summary.checks.pass}, fail ${summary.checks.fail}, blocked ${summary.checks.blocked}, not verified ${summary.checks['not-verified']}, not applicable ${summary.checks['not-applicable']})`);
  console.log(`JSON: ${reports.jsonPath}`);
  console.log(`Markdown: ${reports.markdownPath}`);
  if (summary.status === 'failed' || summary.verdict === 'fail' || summary.verdict === 'blocked') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
