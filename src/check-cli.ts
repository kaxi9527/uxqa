import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { writeBaseline } from './check/baseline.js';
import { formatPrompt, formatText } from './check/format.js';
import { runCheck, type CheckResult } from './check/run.js';
import { findComponents } from './inventory/find.js';
import { findProductRoot, libraryLabel, readInventory } from './inventory/read.js';
import { describeVariants, importHint } from './check/messages.js';
import { RuleConfigError } from './rules/load.js';

const exec = promisify(execFile);

export const SOURCE_COMMANDS = new Set(['check', 'inventory', 'find', 'hook', 'mcp', 'ui']);

interface Flags { values: Map<string, string>; lists: Map<string, string[]>; switches: Set<string>; positional: string[] }

const VALUE_FLAGS = new Set(['--source', '--rules', '--baseline', '--format', '--limit', '--port']);
const LIST_FLAGS = new Set(['--files']);
const SWITCHES = new Set(['--changed', '--staged', '--update-baseline', '--all', '--strict', '--help', '-h', '--no-open']);

function parse(args: string[]): Flags {
  const flags: Flags = { values: new Map(), lists: new Map(), switches: new Set(), positional: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (VALUE_FLAGS.has(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new UsageError(`${arg} 后面要跟一个值`);
      flags.values.set(arg, value);
    } else if (LIST_FLAGS.has(arg)) {
      const values: string[] = [];
      while (args[index + 1] && !args[index + 1].startsWith('--')) values.push(args[++index]);
      if (!values.length) throw new UsageError(`${arg} 后面要跟至少一个文件`);
      flags.lists.set(arg, [...(flags.lists.get(arg) ?? []), ...values]);
    } else if (SWITCHES.has(arg)) flags.switches.add(arg);
    else if (arg.startsWith('--')) throw new UsageError(`不认识的参数：${arg}`);
    else flags.positional.push(arg);
  }
  return flags;
}

export class UsageError extends Error {}

const HELP = `用法：
  uxqa check [--source <项目目录>] [--files <文件...> | --changed | --staged]
             [--rules <rules.json>] [--baseline <baseline.json>] [--update-baseline]
             [--format text|json|prompt] [--all] [--strict]
  uxqa inventory [--source <项目目录>] [--format text|json]
  uxqa find <要找的组件，如"按钮"或"tabs"> [--source <项目目录>] [--format text|json]
  uxqa hook claude [--source <项目目录>]   给 Claude Code 写入后钩子用，从标准输入读取事件
  uxqa hook git [--source <项目目录>]      给 git 提交前钩子用，只检查暂存的文件
  uxqa mcp [--source <项目目录>]           启动组件查询服务（MCP，标准输入输出）
  uxqa ui [--port <端口>] [--no-open]      打开本地控制台（只有本机能访问）

退出码：0 没有需要改的新问题；1 有需要改的新问题（--strict 时"建议改"也算）；2 用法或规则写错。`;

async function gitFiles(root: string, args: string[]): Promise<string[]> {
  const { stdout } = await exec('git', ['-C', root, ...args], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean).map((file) => join(root, file));
}

async function gitTopLevel(root: string): Promise<string> {
  const { stdout } = await exec('git', ['-C', root, 'rev-parse', '--show-toplevel'], { timeout: 5000 });
  return stdout.trim();
}

async function changedFiles(productRoot: string, staged: boolean): Promise<string[]> {
  const top = await gitTopLevel(productRoot).catch(() => { throw new UsageError('--changed / --staged 需要在 git 仓库里使用'); });
  if (staged) return gitFiles(top, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  const tracked = await gitFiles(top, ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']).catch(() => [] as string[]);
  const untracked = await gitFiles(top, ['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...tracked, ...untracked])].filter((file) => file.startsWith(`${productRoot}/`));
}

async function defaultBaseline(productRoot: string, explicit?: string): Promise<string | undefined> {
  if (explicit) return resolve(explicit);
  const path = join(productRoot, '.uxqa/baseline.json');
  return access(path).then(() => path, () => undefined);
}

function exitCode(result: CheckResult, strict: boolean): number {
  return result.summary.newMust > 0 || (strict && result.summary.newDefault > 0) ? 1 : 0;
}

export async function runSourceCommand(argv: string[], io: { stdin?: string } = {}): Promise<number> {
  const [command, ...rest] = argv;
  const sub = command === 'hook' ? rest.shift() : undefined;
  const flags = parse(rest);
  if (flags.switches.has('--help') || flags.switches.has('-h')) { console.log(HELP); return 0; }
  const source = resolve(flags.values.get('--source') ?? process.cwd());
  const format = flags.values.get('--format') ?? 'text';
  if (!['text', 'json', 'prompt'].includes(format)) throw new UsageError('--format 只能是 text、json 或 prompt');
  const limit = flags.switches.has('--all') ? Number.MAX_SAFE_INTEGER : Number(flags.values.get('--limit') ?? 20);

  if (command === 'inventory') {
    const inventory = await readInventory(source);
    if (format === 'json') { console.log(JSON.stringify(inventory, null, 2)); return 0; }
    if (!libraryLabel(inventory)) { console.log(`没有找到组件库（项目：${inventory.productRoot}）。可以在 .uxqa/rules.json 里写 "library": { "root": "组件库目录" }。`); return 1; }
    const main = inventory.components.filter((component) => !/Icon$/.test(component.name));
    console.log(`组件库：${libraryLabel(inventory)}（${main.length} 个组件，另有 ${inventory.components.length - main.length} 个图标；${inventory.tokens.length} 个样式变量）`);
    for (const component of main) console.log(`- ${component.name}${component.label ? `（${component.label}）` : ''}  ${component.importPath}${describeVariants(component) ? `  ${describeVariants(component)}` : ''}`);
    return 0;
  }

  if (command === 'find') {
    const query = flags.positional.join(' ');
    if (!query) throw new UsageError('请写要找的组件，例如：uxqa find 按钮');
    const inventory = await readInventory(source);
    const matches = findComponents(inventory, query);
    if (format === 'json') { console.log(JSON.stringify(matches.map((match) => ({ ...match.component, importHint: importHint(match.component, inventory), why: match.why })), null, 2)); return 0; }
    if (!matches.length) { console.log(`组件库里没有找到和"${query}"相关的组件。需要的话，请在组件库（${libraryLabel(inventory) ?? '未找到'}）里新建，不要写在页面里。`); return 0; }
    for (const match of matches) console.log(`- ${match.component.name}${match.component.label ? `（${match.component.label}）` : ''}：${importHint(match.component, inventory)}${describeVariants(match.component) ? `；${describeVariants(match.component)}` : ''}`);
    return 0;
  }

  if (command === 'ui') {
    const { startConsole, openInBrowser } = await import('./ui/server.js');
    const port = flags.values.has('--port') ? Number(flags.values.get('--port')) : 4870;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError('--port 要写 0 到 65535 之间的数字');
    const server = await startConsole({ port }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && !flags.values.has('--port')) return startConsole({ port: 0 });
      throw error;
    });
    console.log(`uxqa 控制台已启动：${server.url}\n只有这台电脑能访问。按 Ctrl+C 停止。`);
    if (!flags.switches.has('--no-open')) openInBrowser(server.url);
    await new Promise(() => undefined);
    return 0;
  }

  if (command === 'mcp') {
    const { serveMcp } = await import('./mcp.js');
    await serveMcp(source);
    return 0;
  }

  if (command === 'hook') {
    if (sub === 'claude') {
      const { runClaudeHook } = await import('./hooks.js');
      return runClaudeHook(source, io.stdin ?? '', flags.values.get('--rules'));
    }
    if (sub === 'git') {
      const productRoot = await findProductRoot(source);
      const files = await changedFiles(productRoot, true);
      if (!files.length) return 0;
      const result = await runCheck({ source, files, rulesPath: flags.values.get('--rules'), baselinePath: await defaultBaseline(productRoot, flags.values.get('--baseline')) });
      if (result.summary.newMust) {
        process.stderr.write(formatText(result, { limit }));
        process.stderr.write('\n提交已拦下。修好上面"需要改"的问题后再提交；确实要保留的，用 // uxqa-ignore 规则名 -- 理由 写明原因。\n');
      }
      return exitCode(result, flags.switches.has('--strict'));
    }
    throw new UsageError('hook 后面要写 claude 或 git');
  }

  // check
  const productRoot = await findProductRoot(source);
  let files = flags.lists.get('--files');
  if (flags.switches.has('--changed') || flags.switches.has('--staged')) {
    files = await changedFiles(productRoot, flags.switches.has('--staged'));
    if (!files.length) { console.log('没有改动的文件需要检查。'); return 0; }
  }
  const baselinePath = await defaultBaseline(productRoot, flags.values.get('--baseline'));
  if (flags.switches.has('--update-baseline')) {
    if (files?.length) throw new UsageError('--update-baseline 要检查整个项目，不能和 --files、--changed 一起用');
    const target = baselinePath ?? join(productRoot, '.uxqa/baseline.json');
    const result = await runCheck({ source, rulesPath: flags.values.get('--rules') });
    const baseline = await writeBaseline(target, result);
    console.log(`已把现有的 ${baseline.entries.length} 个问题记为老问题：${target}\n以后只有新出现的问题才会被拦下。`);
    return 0;
  }
  const result = await runCheck({ source, files, rulesPath: flags.values.get('--rules'), baselinePath });
  if (format === 'json') console.log(JSON.stringify(result, null, 2));
  else if (format === 'prompt') process.stdout.write(formatPrompt(result, { limit }));
  else process.stdout.write(formatText(result, { limit }));
  return exitCode(result, flags.switches.has('--strict'));
}

export function describeError(error: unknown): { message: string; code: number } {
  if (error instanceof UsageError || error instanceof RuleConfigError) return { message: error.message, code: 2 };
  return { message: error instanceof Error ? error.message : String(error), code: 2 };
}
