import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Where a component library comes from. A project can list several: the first is the most specific
 * ("child", usually the project's own), later ones are shared "parent" libraries (a company library).
 * - root: a folder on this machine (relative to the project, or absolute);
 * - package: an npm package already installed in the project (how private company libraries are usually shipped);
 * - git: a repository link; uxqa clones it into ~/.uxqa/libraries only when the user asks ("拉取 / 更新").
 */
export interface LibrarySource { name: string; root?: string; package?: string; git?: string; ref?: string; path?: string; import?: string }

export function sourceKind(source: LibrarySource): 'local' | 'package' | 'git' {
  return source.git ? 'git' : source.package ? 'package' : 'local';
}

/** Plain-language problems with a list of sources (empty when fine). */
export function validateSources(value: unknown): { sources: LibrarySource[]; problems: string[] } {
  const problems: string[] = [];
  if (value === undefined) return { sources: [], problems };
  if (!Array.isArray(value)) return { sources: [], problems: ['libraries 必须是数组'] };
  const sources: LibrarySource[] = [];
  value.forEach((item, index) => {
    const where = `第 ${index + 1} 个组件库来源`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) { problems.push(`${where}必须是对象`); return; }
    const entry = item as Record<string, unknown>;
    const kinds = ['root', 'package', 'git'].filter((key) => typeof entry[key] === 'string' && (entry[key] as string).trim());
    if (kinds.length !== 1) { problems.push(`${where}要写且只写一个：root（本机文件夹）、package（已安装的 npm 包）或 git（仓库链接）`); return; }
    if (entry.git !== undefined && !safeGitUrl(String(entry.git))) { problems.push(`${where}的 git 链接只能是 https://、ssh://、git@主机:路径 或 file:// 开头`); return; }
    const text = (key: string) => (typeof entry[key] === 'string' && (entry[key] as string).trim() ? { [key]: (entry[key] as string).trim() } : {});
    sources.push({ name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `组件库 ${index + 1}`, ...text('root'), ...text('package'), ...text('git'), ...text('ref'), ...text('path'), ...text('import') });
  });
  return { sources, problems };
}

/** Only ordinary transports: no `ext::` helpers or option-looking values that could run commands. */
export function safeGitUrl(url: string): boolean {
  return /^(https?:\/\/[^\s]+|ssh:\/\/[^\s]+|git@[\w.-]+:[^\s]+|file:\/\/[^\s]+)$/.test(url) && !url.startsWith('-');
}

/** uxqa's own data folder (same rule as the console): UXQA_HOME or ~/.uxqa. */
export function uxqaHome(): string {
  return process.env.UXQA_HOME ?? join(homedir(), '.uxqa');
}

export function libraryCacheDir(dataDir: string, url: string): string {
  return join(dataDir, 'libraries', createHash('sha256').update(url).digest('hex').slice(0, 12));
}

async function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false); }

/** Clone, or update to the latest of `ref`, a git library. Network happens only here, when the user asks. */
export async function pullGitLibrary(dataDir: string, source: LibrarySource): Promise<{ dir: string; commit: string }> {
  if (!source.git || !safeGitUrl(source.git)) throw new Error('git 链接格式不对');
  if (source.ref && !/^[\w./-]+$/.test(source.ref)) throw new Error('分支或标签名只能包含字母、数字和 ./-_');
  const dir = libraryCacheDir(dataDir, source.git);
  const git = (args: string[]) => run('git', args, { timeout: 180_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  try {
    if (await exists(join(dir, '.git'))) {
      await git(['-C', dir, 'fetch', '--depth', '1', 'origin', source.ref ?? 'HEAD']);
      await git(['-C', dir, 'reset', '--hard', 'FETCH_HEAD']);
    } else {
      await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
      await git(['clone', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), '--', source.git, dir]);
    }
  } catch (error) {
    const message = error instanceof Error ? (error as Error & { stderr?: string }).stderr || error.message : String(error);
    throw new Error(`拉取失败：${message.split('\n').filter(Boolean).slice(-1)[0] ?? '原因不明'}。私有仓库请先在终端里用 git 登录过一次。`);
  }
  const commit = (await git(['-C', dir, 'rev-parse', '--short', 'HEAD'])).stdout.trim();
  return { dir, commit };
}

/** The installed package folder, looking up from the project like Node does (works with hoisted monorepos). */
export async function packageDir(productRoot: string, name: string): Promise<string | undefined> {
  for (let dir = productRoot; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (await exists(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/** Folder whose files describe the components: the package's own sources if shipped, else its type declarations. */
export async function componentFolder(packageRoot: string, preferred?: string): Promise<{ dir: string; declarations: boolean }> {
  if (preferred) return { dir: resolve(packageRoot, preferred), declarations: false };
  for (const name of ['src/components', 'src']) if (await exists(join(packageRoot, name))) return { dir: join(packageRoot, name), declarations: false };
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8').catch(() => '{}')) as { types?: string; typings?: string };
  const types = manifest.types ?? manifest.typings;
  if (types) return { dir: dirname(resolve(packageRoot, types)), declarations: true };
  for (const name of ['dist', 'lib', 'types']) if (await exists(join(packageRoot, name))) return { dir: join(packageRoot, name), declarations: true };
  return { dir: packageRoot, declarations: true };
}

export async function packageName(dir: string): Promise<string | undefined> {
  try { return (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: string }).name; } catch { return undefined; }
}
