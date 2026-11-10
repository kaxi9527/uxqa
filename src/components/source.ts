import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runProcess } from './process.js';
import { summarizeReactUsage } from './react-usage.js';
import { analyzeCss } from './css.js';
import type { CodeClone, CssAudit, SourceAudit, SourceLocation, ToolRun } from './types.js';

const require = createRequire(import.meta.url);
const EXCLUDED = new Set(['node_modules','dist','build','coverage','artifacts','vendor','.git','.next','.nuxt','.cache']);
const EXTENSIONS = new Set(['.js','.jsx','.ts','.tsx','.vue','.svelte','.html','.css','.scss']);

export function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await canonicalPath(parent), relative(parent,path));
  }
}

async function listSources(root: string): Promise<string[]> {
  const files: string[] = [];
  let bytes = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || EXCLUDED.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!entry.isFile() || !EXTENSIONS.has(extname(entry.name)) || /\.(?:min|test|spec|d)\.[^.]+$/.test(entry.name)) continue;
      const stat = await lstat(path);
      bytes += stat.size;
      if (stat.size > 256_000 || bytes > 16_000_000 || files.length >= 1000) {
        throw new Error('Source scan exceeds limits (1000 files, 256 KB/file, 16 MB total); select a narrower source directory');
      }
      files.push(relative(root,path));
    }
  }
  await visit(root);
  return files;
}

function location(raw: Record<string, unknown>, stage: string): SourceLocation {
  const name = String(raw.name ?? raw.file ?? '');
  const start = raw.start;
  const line = typeof start === 'object' && start ? Number((start as Record<string,unknown>).line) : Number(start ?? raw.startLine ?? 1);
  return { file: isAbsolute(name) ? relative(stage,name) : name.replace(/^\.\//,''), line: Number.isFinite(line) ? line : 1 };
}

export async function validateSourcePaths(sourceDir: string, outDir: string): Promise<{root:string;output:string}> {
  const root = await realpath(resolve(sourceDir)).catch(() => { throw new Error(`Source directory does not exist: ${sourceDir}`); });
  if (!(await lstat(root)).isDirectory()) throw new Error('Source must be a directory');
  const output = await canonicalPath(resolve(outDir));
  if (inside(root, output)) throw new Error('Audit output must not be inside or overlap the source tree');
  return {root,output};
}

export async function auditSource(sourceDir: string, outDir: string): Promise<SourceAudit> {
  const {root,output} = await validateSourcePaths(sourceDir,outDir);
  const files = await listSources(root);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const tools: ToolRun[] = [];
  const duplicates: CodeClone[] = [];
  let react = summarizeReactUsage({},'');
  const css: CssAudit = {status:'complete',analyses:[],gaps:[]};
  const stage = await mkdtemp(join(tmpdir(),'uxqa-source-snapshot-'));
  try {
    for (const file of files) {
      await mkdir(dirname(join(stage,file)), { recursive: true });
      await copyFile(join(root,file), join(stage,file), constants.COPYFILE_FICLONE);
    }
    const cloneOutput = join(output,'jscpd');
    try {
      if (files.length === 0) tools.push({ name:'jscpd', version:'5.4.1', status:'skipped' });
      else {
        const jscpdRoot = dirname(require.resolve('jscpd/package.json'));
        await runProcess(process.execPath, [join(jscpdRoot,'run-jscpd.js'), '--reporters','json','--output',cloneOutput,
          '--min-lines','5','--min-tokens','40','--threshold','100','--workers','1','--ignore-identifiers','--ignore-literals','--similarity','--silent',stage],stage);
        const artifact = join(cloneOutput,'jscpd-report.json');
        const report = JSON.parse(await readFile(artifact,'utf8'));
        if (!Array.isArray(report.duplicates)) throw new Error('Unsupported jscpd report schema: duplicates missing');
        for (const clone of report.duplicates) duplicates.push({
          kind: String(clone.kind ?? 'exact'), lines: Number(clone.lines ?? 0),
          first: location(clone.firstFile,stage), second: location(clone.secondFile,stage),
        });
        // Keep upstream evidence while replacing disposable snapshot paths.
        await writeFile(artifact, JSON.stringify({ ...report, duplicates: report.duplicates.map((clone: Record<string,unknown>, index: number) => ({
          ...clone, fragment: undefined, firstFile: { ...(clone.firstFile as object), name: duplicates[index].first.file },
          secondFile: { ...(clone.secondFile as object), name: duplicates[index].second.file },
        })) }, null,2), { mode: 0o600 });
        tools.push({ name:'jscpd',version:'5.4.1',status:'complete',artifact });
      }
    } catch (error) { tools.push({ name:'jscpd',version:'5.4.1',status:'failed',error:error instanceof Error ? error.message : String(error) }); }

    try {
      if (!files.some((file) => /\.[jt]sx?$/.test(file))) tools.push({ name:'react-scanner',version:'1.2.0',status:'skipped' });
      else {
        const artifact = join(output,'react-components.json');
        const scannerRoot = dirname(require.resolve('react-scanner/package.json'));
        const configPath = join(stage,'scanner.config.cjs');
        const scannerConfig = JSON.stringify({
          crawlFrom: '.', rootDir:stage, globs:['**/*.tsx','**/*.jsx','**/*.ts','**/*.js'],includeSubComponents:true,
          processors:[['raw-report',{outputTo:artifact}]],
        });
        await writeFile(configPath, `module.exports = {...${scannerConfig}, getPropValue({node,propName,defaultGetPropValue}) {
          if (/password|secret|token|api.?key|authorization|cookie/i.test(propName) || propName==='value' || propName==='defaultValue') return {kind:'redacted',value:'[redacted]'};
          const literal = node && (node.type==='Literal' || (node.type==='JSXExpressionContainer' && node.expression.type==='Literal'));
          return {kind:node===null ? 'shorthand' : literal ? 'literal' : 'expression',value:node===null ? true : defaultGetPropValue(node)};
        }};\n`);
        const processResult = await runProcess(process.execPath,[join(scannerRoot,'bin/react-scanner'),'--config',configPath],stage);
        if (/Failed to parse:/.test(processResult.stderr)) throw new Error('react-scanner could not parse some source files; inventory incomplete');
        const report = JSON.parse(await readFile(artifact,'utf8'));
        react = summarizeReactUsage(report,stage);
        await writeFile(artifact,JSON.stringify(report,null,2),{mode:0o600});
        tools.push({name:'react-scanner',version:'1.2.0',status:'complete',artifact});
      }
    } catch (error) { tools.push({name:'react-scanner',version:'1.2.0',status:'failed',error:error instanceof Error ? error.message : String(error)}); }

    try {
      const cssFiles = files.filter((file) => file.endsWith('.css'));
      if (files.some((file) => file.endsWith('.scss'))) css.gaps.push('SCSS is not parsed as plain CSS; provide compiled browser stylesheets');
      if (cssFiles.length) {
        const text = (await Promise.all(cssFiles.map((file) => readFile(join(stage,file),'utf8')))).join('\n');
        css.analyses.push(analyzeCss(text,'source CSS files'));
      }
      css.status = css.gaps.length ? 'partial':'complete';
      if (cssFiles.length || css.gaps.length) {
        css.artifact = join(output,'css-metrics.json');
        await writeFile(css.artifact,JSON.stringify({...css,files:cssFiles},null,2),{mode:0o600});
      }
      tools.push({name:'project-wallace',version:'9.9.3',status:css.gaps.length ? 'partial':cssFiles.length ? 'complete':'skipped',artifact:css.artifact});
    } catch (error) {
      css.status='partial'; css.gaps.push(error instanceof Error ? error.message:String(error));
      tools.push({name:'project-wallace',version:'9.9.3',status:'failed',error:css.gaps.join('; ')});
    }
    return { status:tools.some((tool) => tool.status==='failed' || tool.status==='partial') ? 'partial':'complete',root,files,duplicates,
      components:react.components,reuse:react.reuse,importConflicts:react.importConflicts,css,tools };
  } finally { await rm(stage,{recursive:true,force:true}); }
}
