import { execFile } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Find where a project's dev server is running, so beginners do not have to know their own port.
 * Only 127.0.0.1 / localhost ports are probed. A server counts as "this project" only when it serves this
 * project's own package.json (Vite and most static dev servers do); otherwise a running port that the project's
 * config names is offered with that explanation, and other running ports are listed as "maybe".
 */
export interface PreviewGuess { url: string; why: string; sure: boolean }
export interface PreviewSearch { found?: PreviewGuess; others: PreviewGuess[]; start: { command: string; folder: string; expected?: string } }

const COMMON = [5173, 5174, 5175, 3000, 3001, 3002, 8080, 4200, 4321, 8000, 5000, 4173, 6006];

async function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false); }

async function packageManager(root: string): Promise<string> {
  if (await exists(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(join(root, 'bun.lockb')) || await exists(join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

/** Ports the project itself declares: script flags, PORT=, vite/next/angular/astro defaults and config files. */
async function declaredPorts(root: string, manifest: Record<string, unknown>): Promise<{ ports: number[]; script?: string }> {
  const scripts = (manifest.scripts ?? {}) as Record<string, string>;
  const script = ['dev', 'start', 'serve', 'develop'].find((name) => typeof scripts[name] === 'string');
  const ports: number[] = [];
  const text = script ? scripts[script] : '';
  for (const match of text.matchAll(/(?:--port[ =]|-p\s+|PORT=)(\d{2,5})/g)) ports.push(Number(match[1]));
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
    const config = await readFile(join(root, name), 'utf8').catch(() => '');
    const port = config.match(/\bport\s*:\s*(\d{2,5})/);
    if (port) ports.push(Number(port[1]));
  }
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) } as Record<string, string>;
  if (deps.vite || /\bvite\b/.test(text)) ports.push(5173);
  if (deps.next || deps['react-scripts'] || deps.nuxt) ports.push(3000);
  if (deps['@angular/core']) ports.push(4200);
  if (deps.astro) ports.push(4321);
  if (deps['@vue/cli-service'] || deps['webpack-dev-server']) ports.push(8080);
  return { ports: [...new Set(ports)], ...(script ? { script } : {}) };
}

/**
 * Local ports whose listening process was started inside this project folder (macOS / Linux, via lsof).
 * This is how a dev server on an unusual port (e.g. --port 5180) is still recognised as "this project".
 */
async function portsStartedHere(root: string): Promise<number[]> {
  if (process.platform === 'win32') return [];
  const realRoot = await realpath(root).catch(() => root);
  const listening = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { timeout: 4000 }).then((result) => result.stdout, () => '');
  const byPid = new Map<string, number[]>();
  let pid = '';
  for (const line of listening.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1);
    const address = line.startsWith('n') ? line.slice(1).match(/^(127\.0\.0\.1|\[::1\]|\*|localhost|\[::\]):(\d+)$/) : null;
    if (pid && address) byPid.set(pid, [...(byPid.get(pid) ?? []), Number(address[2])]);
  }
  const ports: number[] = [];
  for (const [id, list] of byPid) {
    const cwd = await run('lsof', ['-a', '-p', id, '-d', 'cwd', '-Fn'], { timeout: 2000 }).then((result) => result.stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1), () => undefined);
    if (cwd && (cwd === realRoot || cwd.startsWith(realRoot + sep))) ports.push(...list);
  }
  return [...new Set(ports)];
}

async function probe(url: string, timeout = 900): Promise<Response | undefined> {
  try { return await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'manual' }); } catch { return undefined; }
}

export async function findPreview(root: string): Promise<PreviewSearch> {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8').catch(() => '{}')) as Record<string, unknown>;
  const { ports, script } = await declaredPorts(root, manifest);
  const pm = await packageManager(root);
  const command = script ? (pm === 'npm' && script === 'start' ? 'npm start' : `${pm} run ${script}`) : `${pm} run dev`;
  const start = { command, folder: root, ...(ports[0] ? { expected: `http://localhost:${ports[0]}` } : {}) };

  const mine = await portsStartedHere(root);
  const candidates = [...new Set([...mine, ...ports, ...COMMON])];
  const running = (await Promise.all(candidates.map(async (port) => ((await probe(`http://127.0.0.1:${port}/`)) ? port : undefined))))
    .filter((port): port is number => port !== undefined);

  const others: PreviewGuess[] = [];
  let found: PreviewGuess | undefined;
  for (const port of running) {
    const url = `http://localhost:${port}`;
    // Same project: the dev server hands out this project's own package.json.
    const served = await probe(`http://127.0.0.1:${port}/package.json`);
    const body = served?.ok ? await served.text().catch(() => '') : '';
    let same = false;
    try { same = !!manifest.name && (JSON.parse(body) as { name?: string }).name === manifest.name; } catch { same = false; }
    if (!same && mine.includes(port) && !found?.sure) {
      if (found) others.push({ ...found, why: '这个地址有服务在跑，但看不出是不是这个项目' });
      found = { url, why: '这个地址是在这个项目文件夹里启动的', sure: true };
      continue;
    }
    if (same) {
      if (found?.sure) continue;
      if (found) others.push({ ...found, why: '这个地址有服务在跑，但看不出是不是这个项目' });
      found = { url, why: '这个地址正在运行的就是这个项目', sure: true };
      continue;
    }
    if (ports.includes(port) && !found) { found = { url, why: `项目配置里写的端口是 ${port}，这个地址正在运行`, sure: false }; continue; }
    others.push({ url, why: '这个地址有服务在跑，但看不出是不是这个项目', sure: false });
  }
  return { ...(found ? { found } : {}), others, start };
}
