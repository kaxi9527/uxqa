import { access, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export interface ProjectCandidate { root: string; name: string; why: string; /** Has a component library uxqa can read; listed first. */ library: boolean }

const SKIP = new Set(['node_modules', 'dist', 'build', 'vendor', 'coverage', 'artifacts', 'Library', 'Applications', 'Pictures', 'Music', 'Movies', 'target', 'out']);

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/** Look for front-end projects under a folder (default: ~/Projects). Read-only and bounded. */
/** Where scanning starts when the user does not name a folder. */
export async function defaultScanRoot(): Promise<string> {
  return join(homedir(), 'Projects');
}

export async function discoverProjects(start?: string, limits = { depth: 4, dirs: 4000, results: 60 }): Promise<ProjectCandidate[]> {
  const root = start ?? await defaultScanRoot();
  const found: ProjectCandidate[] = [];
  let visited = 0;
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > limits.depth || visited >= limits.dirs || found.length >= limits.results) return;
    visited++;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if (depth === 0) throw error; return; }
    const names = new Set(entries.map((entry) => entry.name));
    if (names.has('package.json')) {
      const library = names.has('components.json') ? '有 shadcn 组件库配置'
        : (await exists(join(dir, '.uxqa'))) ? '已有 uxqa 配置'
        : (await exists(join(dir, 'src/components/ui'))) ? '有 src/components/ui 组件目录'
        : undefined;
      const framework = await frontEnd(join(dir, 'package.json'));
      if (library || framework) found.push({ root: dir, name: basename(dir), why: [framework ? `${framework} 项目` : '前端项目', library].filter(Boolean).join('，'), library: !!library });
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      await visit(join(dir, entry.name), depth + 1);
    }
  }
  await visit(root, 0);
  // Projects with a readable component library first, then the rest, each alphabetically.
  return found.sort((a, b) => Number(b.library) - Number(a.library) || a.name.localeCompare(b.name));
}

const FRAMEWORKS: Array<[string, string]> = [['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@angular/core', 'Angular'], ['astro', 'Astro'], ['@sveltejs/kit', 'SvelteKit'], ['svelte', 'Svelte'], ['solid-js', 'Solid'], ['vue', 'Vue'], ['react', 'React'], ['vite', 'Vite']];

/** Which front-end framework a package uses, if any (read from its dependencies). */
async function frontEnd(manifest: string): Promise<string | undefined> {
  try {
    const data = JSON.parse(await readFile(manifest, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...data.dependencies, ...data.devDependencies };
    return FRAMEWORKS.find(([name]) => name in deps)?.[1];
  } catch { return undefined; }
}
