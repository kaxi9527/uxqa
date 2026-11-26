import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { auditFigma } from './audit.js';
import { exportScripts } from './exporter.js';
import { figmaSummary, writeFigmaReport } from './reports.js';
import { captureInput, ingestCapture, PLUGIN_UI } from './ingest.js';
import { validateGraph, writeGraphReport } from './graph.js';
import { validateChunk, validateConfig, validateIndex } from './validate.js';
import { unpackCapture } from './transport.js';

export const FIGMA_HELP = `QA Master Figma (read-only)
  uxqa figma prepare --config <figma.json> [--out <empty-directory>] [--plugin-id <id>]
  uxqa figma ingest (--from <download.json|-> | --from-mcp-result <file|-> | --from-clipboard) --out <capture-directory>
  uxqa figma check --input <capture-directory> [--out <empty-directory>] [--fail-on fail|review]
  uxqa figma graph --input <capture-directory|prototype.json> [--out <empty-directory>] [--fail-on fail|review]

Import the prepared manifest.json as a Figma desktop development plugin; capture and download the file, then ingest it locally.
index.js, collect.js and graph.js are also available for an existing Figma Plugin API/MCP connection.
Default gate (review): 1 for failures, reviews, unverified or partial coverage. --fail-on fail: 1 only for confirmed failures.
Both policies: 2 for invalid input/usage. Reports retain all evidence and gaps. See docs/figma-readonly.md.`;

async function boundedJson(path: string): Promise<{ raw: unknown; hash: string; bytes: number }> {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 8 * 1024 * 1024) throw new Error(`Expected regular JSON file up to 8 MiB: ${path}`);
  const buffer = await readFile(path);
  if (buffer.length > 8 * 1024 * 1024) throw new Error('JSON input grew beyond 8 MiB');
  const raw = unpackCapture(JSON.parse(buffer.toString('utf8')));
  return { raw, hash: createHash('sha256').update(buffer).digest('hex'), bytes: Math.max(buffer.length, Buffer.byteLength(JSON.stringify(raw))), };
}
async function emptyOutput(path: string): Promise<void> {
  const exists = await readdir(path).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
  if (exists.length) throw new Error('Output directory is not empty; existing evidence is preserved');
  await mkdir(path, { recursive: true, mode: 0o700 });
}
export async function runFigmaCommand(argv: string[]): Promise<number> {
  try {
    if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(FIGMA_HELP); return 0; }
    const command = argv[0];
    const allowed:Record<string,string[]>={prepare:['--config','--out','--plugin-id'],ingest:['--from','--from-mcp-result','--from-clipboard','--out'],check:['--input','--out','--fail-on'],graph:['--input','--out','--fail-on']};
    if (!Object.hasOwn(allowed,command)) throw new Error(`Unknown figma command: ${command}`);
    const flags = new Map<string, string>();
    for (let i = 1; i < argv.length; i++) {
      const key=argv[i],value=key==='--from-clipboard'?'true':argv[++i];
      if (!allowed[command].includes(key) || !value || value.startsWith('--') || flags.has(key)) throw new Error(`Invalid or repeated argument: ${key}`);
      flags.set(key, value);
    }
    const gate=flags.get('--fail-on')??'review';if(!['fail','review'].includes(gate))throw new Error('--fail-on must be fail or review');
    if(command==='ingest'){
      const inputs=['--from','--from-mcp-result','--from-clipboard'].filter(f=>flags.has(f));
      if(inputs.length!==1||!flags.has('--out'))throw new Error('ingest needs one input and --out');
      const files=await ingestCapture(await captureInput(flags.get(inputs[0])!,inputs[0]==='--from-clipboard'),resolve(flags.get('--out')!));
      console.log('已导入 / Ingested '+files.length+' evidence files · '+resolve(flags.get('--out')!));return 0;
    }
    if (!flags.has(command==='prepare'?'--config':'--input'))throw new Error('prepare requires --config; check/graph require --input');
    const out = resolve(flags.get('--out') || join(process.env.UXQA_OUTPUT_ROOT || 'artifacts', `figma-${Date.now()}-${randomUUID().slice(0, 8)}`));
    if (command === 'prepare') {
      const configPath = await realpath(resolve(flags.get('--config')!));
      const config = validateConfig((await boundedJson(configPath)).raw), exportId = randomUUID();
      const scripts = exportScripts(config, exportId);
      await emptyOutput(out);
      const pluginId=flags.get('--plugin-id')??BigInt('0x'+exportId.replaceAll('-','').slice(0,15)).toString();
      if(!/^\d+$/.test(pluginId))throw new Error('Expected a numeric development plugin ID');
      const manifest={name:'QA Master · Read-only capture',id:pluginId,api:'1.0.0',editorType:['figma'],main:'plugin.js',ui:'ui.html',documentAccess:'dynamic-page',networkAccess:{allowedDomains:['none']}};
      // Figma executes the plugin main in its sandbox; emit conservative JavaScript for that entrypoint.
      const ts=await import('typescript');
      const plugin=ts.transpileModule(scripts.plugin,{compilerOptions:{target:ts.ScriptTarget.ES2015,module:ts.ModuleKind.None}}).outputText;
      for (const [name, content] of [['config.json', JSON.stringify(config, null, 2)], ['index.js', scripts.index], ['collect.js', scripts.collect],['graph.js',scripts.graph],['plugin.js',plugin],['ui.html',PLUGIN_UI],['manifest.json',JSON.stringify(manifest,null,2)]])
        await writeFile(join(out, name), content, { flag: 'wx', mode: 0o600 });
      console.log(`Figma read-only capture prepared: ${out}\nExport ID: ${exportId}\nImport manifest.json in Figma Desktop → Plugins → Development, or run index.js through your existing connection. Live indexing checks theme modes before component batches.`);
      return 0;
    }
    const input = await realpath(resolve(flags.get('--input')!));
    // Resolve existing ancestors so a symlink cannot place output inside the capture directory.
    let ancestor = out, suffix: string[] = [];
    for (;;) { try { ancestor = await realpath(ancestor); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const parent = dirname(ancestor); if (parent === ancestor) throw e; suffix.unshift(basename(ancestor)); ancestor = parent; } }
    const actualOut = resolve(ancestor, ...suffix), rel = relative(input, actualOut);
    if (rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) throw new Error('Output must be outside the input capture directory');
    if(command==='graph'){
      const path=(await lstat(input)).isDirectory()?join(input,'prototype.json'):input;
      const graph=validateGraph(await captureInput(path,false));
      await emptyOutput(actualOut);const r=await writeGraphReport(graph,actualOut);
      console.log(`Prototype · ${r.frames} screens · ${r.actions} actions · ${r.checks.filter(c=>c.status!=='pass').length} findings/gaps · ${actualOut}`);
      return r.checks.some(c=>c.status==='fail'||(gate==='review'&&(c.status==='review'||c.status==='not-verified')))?1:0;
    }
    const indexInput = await boundedJson(join(input, 'index.json')), index = validateIndex(indexInput.raw);
    const files = (await readdir(input)).filter(n => /^chunk-[a-zA-Z0-9_-]+\.json$/.test(n)).sort();
    if (files.length > 500) throw new Error('Capture exceeds 500 chunks');
    const chunks = [], hashes: Record<string, string> = { 'index.json': indexInput.hash }; let bytes = indexInput.bytes;
    for (const file of files) {
      const result = await boundedJson(join(input, file)); bytes += result.bytes;
      if (bytes > 64 * 1024 * 1024) throw new Error('Capture exceeds 64 MiB; narrow the page scope');
      hashes[file] = result.hash; chunks.push(validateChunk(result.raw, index));
    }
    const receipt=await boundedJson(join(input,'index.receipt.json')).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
    const receiptHash=receipt?(receipt.raw as {sha256?:string})?.sha256:undefined;
    if(receipt && (typeof receiptHash!=='string'||!(/^[0-9a-f]{64}$/).test(receiptHash)))throw new Error('Invalid original index receipt');
    const report = auditFigma(index, chunks, hashes,receiptHash);
    await emptyOutput(actualOut); await writeFigmaReport(report, actualOut);
    console.log(`QA Master Figma ${figmaSummary(report)}\n${report.coverage.inventoryEvidence}\n${JSON.stringify(report.summary)}\nHTML: ${join(actualOut, 'figma.html')}\nJSON: ${join(actualOut, 'figma.json')}\nMarkdown: ${join(actualOut, 'figma.md')}`);
    return gate==='fail'?Number(report.summary.fail>0):Number(report.verdict!=='limited-pass'||report.status!=='complete');
  } catch (e) { console.error(`QA Master Figma: ${e instanceof Error ? e.message : String(e)}`); return 2; }
}
