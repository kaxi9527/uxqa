import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { auditFigma } from './audit.js';
import { exportScripts } from './exporter.js';
import { writeFigmaReport } from './reports.js';
import { validateChunk, validateConfig, validateIndex } from './validate.js';
import { unpackCapture } from './transport.js';

export const FIGMA_HELP = `UXQA Figma (read-only)
  uxqa figma prepare --config <figma.json> [--out <empty-directory>]
  uxqa figma check --input <capture-directory> [--out <empty-directory>]

prepare generates index.js and collect.js for an existing authenticated Figma Plugin API/MCP connection.
Save the returned index as index.json, then replace UXQA_IDS in collect.js with bounded batches
of IDs from that index and save each return as chunk-001.json, chunk-002.json, etc.
check reads only those JSON files. It never connects to or modifies Figma, source code or accounts.
No credentials are stored. See docs/figma-readonly.md for the capture and coverage contract.
Exit: 0 limited pass; 1 findings, review or partial coverage; 2 input/usage error.`;

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
    if (!['prepare', 'check'].includes(command)) throw new Error(`Unknown figma command: ${command}`);
    const flags = new Map<string, string>();
    for (let i = 1; i < argv.length; i += 2) {
      const key = argv[i], value = argv[i + 1];
      if (!['--config', '--input', '--out'].includes(key) || !value || value.startsWith('--') || flags.has(key)) throw new Error(`Invalid or repeated argument: ${key}`);
      flags.set(key, value);
    }
    if (command === 'prepare' ? !flags.has('--config') || flags.has('--input') : !flags.has('--input') || flags.has('--config')) throw new Error('prepare requires --config; check requires --input');
    const out = resolve(flags.get('--out') || join(process.env.UXQA_OUTPUT_ROOT || 'artifacts', `figma-${Date.now()}-${randomUUID().slice(0, 8)}`));
    if (command === 'prepare') {
      const configPath = await realpath(resolve(flags.get('--config')!));
      const config = validateConfig((await boundedJson(configPath)).raw), exportId = randomUUID();
      const scripts = exportScripts(config, exportId);
      await emptyOutput(out);
      for (const [name, content] of [['config.json', JSON.stringify(config, null, 2)], ['index.js', scripts.index], ['collect.js', scripts.collect]])
        await writeFile(join(out, name), content, { flag: 'wx', mode: 0o600 });
      console.log(`Figma read-only capture prepared: ${out}\nExport ID: ${exportId}\nRun index.js through your existing Figma connection. No design was changed.`);
      return 0;
    }
    const input = await realpath(resolve(flags.get('--input')!));
    // Resolve existing ancestors so a symlink cannot place output inside the capture directory.
    let ancestor = out, suffix: string[] = [];
    for (;;) { try { ancestor = await realpath(ancestor); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const parent = dirname(ancestor); if (parent === ancestor) throw e; suffix.unshift(basename(ancestor)); ancestor = parent; } }
    const actualOut = resolve(ancestor, ...suffix), rel = relative(input, actualOut);
    if (rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) throw new Error('Output must be outside the input capture directory');
    const indexInput = await boundedJson(join(input, 'index.json')), index = validateIndex(indexInput.raw);
    const files = (await readdir(input)).filter(n => /^chunk-[a-zA-Z0-9_-]+\.json$/.test(n)).sort();
    if (files.length > 500) throw new Error('Capture exceeds 500 chunks');
    const chunks = [], hashes: Record<string, string> = { 'index.json': indexInput.hash }; let bytes = indexInput.bytes;
    for (const file of files) {
      const result = await boundedJson(join(input, file)); bytes += result.bytes;
      if (bytes > 32 * 1024 * 1024) throw new Error('Capture exceeds 32 MiB; narrow the page scope');
      hashes[file] = result.hash; chunks.push(validateChunk(result.raw, index));
    }
    const report = auditFigma(index, chunks, hashes);
    await emptyOutput(actualOut); await writeFigmaReport(report, actualOut);
    console.log(`UXQA Figma ${report.status} / ${report.verdict}\nComponents: ${report.coverage.capturedComponents}/${report.coverage.expectedComponents}\n${JSON.stringify(report.summary)}\nHTML: ${join(actualOut, 'figma.html')}\nJSON: ${join(actualOut, 'figma.json')}\nMarkdown: ${join(actualOut, 'figma.md')}`);
    return report.verdict === 'limited-pass' && report.status === 'complete' ? 0 : 1;
  } catch (e) { console.error(`UXQA Figma: ${e instanceof Error ? e.message : String(e)}`); return 2; }
}
