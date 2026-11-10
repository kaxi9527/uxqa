import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The browser Playwright drives for screenshots is not shipped with uxqa (about 100 MiB).
 * This module says whether it is on this computer, what downloading it would fetch (file, source, size, folder),
 * and downloads it only when asked. It uses Playwright's own installer from the bundled playwright-core, so the
 * browser version always matches, and PLAYWRIGHT_BROWSERS_PATH / PLAYWRIGHT_DOWNLOAD_HOST keep working.
 */

/** shell = the headless browser used for screenshots and page checks; chromium = the windowed browser for logging in. */
export type BrowserKind = 'shell' | 'chromium';

export interface BrowserFile { name: string; url: string; bytes?: number; servedBy?: string }
export interface BrowserEntry { title: string; location: string; url: string }
export interface BrowserInfo {
  kind: BrowserKind;
  ready: boolean;
  /** What it is for, in plain words. */
  purpose: string;
  title: string;
  location: string;
  files: BrowserFile[];
  totalBytes?: number;
  source: string;
  /** Where the links actually lead (the official addresses redirect, e.g. to Google's Chrome for Testing storage). */
  servedBy?: string;
}

export interface InstallState {
  kind: BrowserKind;
  state: 'running' | 'done' | 'failed';
  percent: number;
  message: string;
  error?: string;
}

const KIND_ARGS: Record<BrowserKind, string[]> = { shell: ['--only-shell', 'chromium'], chromium: ['--no-shell', 'chromium'] };
const PURPOSE: Record<BrowserKind, string> = {
  shell: '给页面截图、检查页面用（后台运行，看不到窗口）',
  chromium: '打开一个浏览器窗口让你登录自己的产品',
};

function playwrightCli(): string {
  // Resolve playwright-core through playwright so the installer matches the library that launches the browser.
  const fromApp = createRequire(import.meta.url);
  const fromPlaywright = createRequire(fromApp.resolve('playwright/package.json'));
  return join(dirname(fromPlaywright.resolve('playwright-core/package.json')), 'cli.js');
}

function runCli(args: string[], onLine?: (line: string) => void, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [playwrightCli(), ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, windowsHide: true, ...(signal ? { signal } : {}) });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const feed = (text: string) => {
      pending += text;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      for (const line of lines) onLine?.(line);
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; feed(chunk.toString('utf8')); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; feed(chunk.toString('utf8')); });
    child.on('error', fail);
    child.on('close', (code) => { if (pending) onLine?.(pending); done({ code: code ?? 1, stdout, stderr }); });
  });
}

/** Parses `playwright install --dry-run` output into one entry per thing it would download. */
export function parseDryRun(output: string): BrowserEntry[] {
  const entries: BrowserEntry[] = [];
  for (const block of output.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const location = lines.find((line) => line.startsWith('Install location:'))?.replace(/^Install location:\s*/, '');
    const url = lines.find((line) => line.startsWith('Download url:'))?.replace(/^Download url:\s*/, '');
    const title = lines.find((line) => !line.includes(':') || /\(playwright /.test(line));
    if (location && url && title) entries.push({ title, location, url });
  }
  return entries;
}

/** Playwright writes this marker only after a download was unpacked completely. */
export function isInstalled(location: string): boolean {
  return existsSync(join(location, 'INSTALLATION_COMPLETE'));
}

const plans = new Map<BrowserKind, BrowserEntry[]>();

async function plan(kind: BrowserKind): Promise<BrowserEntry[]> {
  const known = plans.get(kind);
  if (known) return known;
  const result = await runCli(['install', '--dry-run', ...KIND_ARGS[kind]]);
  const entries = parseDryRun(result.stdout);
  if (!entries.length) throw new Error(`没能读出浏览器组件的下载信息：${(result.stderr || result.stdout).trim().split('\n')[0] || '原因不明'}`);
  plans.set(kind, entries);
  return entries;
}

/** Whether the browser for `kind` is ready; no network. */
export async function browserReady(kind: BrowserKind = 'shell'): Promise<boolean> {
  const entries = await plan(kind);
  return isInstalled(entries[0].location);
}

/** Sizes measured when the download package was built (app/browser-sizes.json); used when HEAD cannot reach the host. */
function packagedSizes(): Record<string, number> {
  try { return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'browser-sizes.json'), 'utf8')) as Record<string, number>; } catch { return {}; }
}

const probes = new Map<string, { bytes?: number; servedBy?: string }>();

async function probe(url: string): Promise<{ bytes?: number; servedBy?: string }> {
  const known = probes.get(url);
  if (known?.bytes) return known;
  const result = await headProbe(url);
  probes.set(url, result);
  return result;
}

async function headProbe(url: string): Promise<{ bytes?: number; servedBy?: string }> {
  const packaged = packagedSizes()[url];
  try {
    // HEAD only reads the size and where the link leads; nothing is downloaded.
    const reply = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(12000) });
    const length = Number(reply.headers.get('content-length'));
    const servedBy = new URL(reply.url || url).host;
    return { ...(reply.ok && Number.isFinite(length) && length > 0 ? { bytes: length } : packaged ? { bytes: packaged } : {}), ...(servedBy !== new URL(url).host ? { servedBy } : {}) };
  } catch { return packaged ? { bytes: packaged } : {}; }
}

/** Everything the person needs before agreeing: which files, from where, how big, saved where. */
export async function browserInfo(kind: BrowserKind = 'shell'): Promise<BrowserInfo> {
  const entries = await plan(kind);
  const ready = isInstalled(entries[0].location);
  const missing = ready ? [] : entries.filter((entry) => !isInstalled(entry.location));
  const files: BrowserFile[] = await Promise.all(missing.map(async (entry) => {
    const { bytes, servedBy } = await probe(entry.url);
    return { name: basename(new URL(entry.url).pathname), url: entry.url, ...(bytes ? { bytes } : {}), ...(servedBy ? { servedBy } : {}) };
  }));
  const known = files.every((file) => file.bytes);
  const hosts = [...new Set(files.map((file) => new URL(file.url).host))];
  const redirects = [...new Set(files.map((file) => file.servedBy).filter((host): host is string => !!host && !hosts.includes(host)))];
  return {
    kind, ready, purpose: PURPOSE[kind], title: entries[0].title,
    location: dirname(entries[0].location),
    files,
    ...(files.length && known ? { totalBytes: files.reduce((sum, file) => sum + (file.bytes ?? 0), 0) } : {}),
    source: hosts.join('、'),
    ...(redirects.length ? { servedBy: redirects.join('、') } : {}),
  };
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '大小未知';
  return `${(bytes / 1048576).toFixed(1)} MiB`;
}

let current: InstallState | undefined;

export function installState(): InstallState | undefined {
  return current;
}

/** Downloads the browser. Callers must only call this after the person agreed to the files shown by browserInfo. */
export function installBrowser(kind: BrowserKind = 'shell', onUpdate?: (state: InstallState) => void): Promise<InstallState> {
  if (current?.state === 'running') return Promise.resolve(current);
  const state: InstallState = { kind, state: 'running', percent: 0, message: '正在连接下载地址' };
  current = state;
  const update = () => onUpdate?.({ ...state });
  let file = 0;
  let total = 1;
  return plan(kind).then((entries) => {
    total = entries.filter((entry) => !isInstalled(entry.location)).length || 1;
    return runCli(['install', ...KIND_ARGS[kind]], (line) => {
      if (/^Downloading /.test(line)) { file += 1; state.message = `正在下载第 ${Math.min(file, total)}/${total} 个文件`; update(); }
      const match = line.match(/(\d{1,3})% of ([\d.]+ ?\w+)/);
      if (match) {
        const within = Number(match[1]);
        state.percent = Math.min(99, Math.round(((Math.max(file, 1) - 1) * 100 + within) / total));
        state.message = `正在下载第 ${Math.max(file, 1)}/${total} 个文件（${match[1]}%，共 ${match[2]}）`;
        update();
      }
    });
  }).then(async (result) => {
    plans.delete(kind);
    if (result.code === 0 && await browserReady(kind)) {
      Object.assign(state, { state: 'done', percent: 100, message: '浏览器组件已下载好' });
    } else {
      const reason = (result.stderr || result.stdout).split('\n').map((line) => line.trim()).find((line) => /error|failed|ECONN|ETIMEDOUT|ENOTFOUND|EACCES|ENOSPC/i.test(line)) ?? '原因不明';
      Object.assign(state, { state: 'failed', message: '浏览器组件没有下载成功', error: plainError(reason) });
    }
    update();
    return { ...state };
  }, (error: unknown) => {
    Object.assign(state, { state: 'failed', message: '浏览器组件没有下载成功', error: plainError(error instanceof Error ? error.message : String(error)) });
    update();
    return { ...state };
  });
}

function plainError(reason: string): string {
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed? ?out|socket hang up/i.test(reason)) return `连不上下载地址，请检查网络后再试。（${reason}）`;
  if (/ENOSPC/i.test(reason)) return `磁盘空间不够，请清理出约 300 MiB 后再试。（${reason}）`;
  if (/EACCES|EPERM/i.test(reason)) return `没有权限写入保存位置。（${reason}）`;
  return reason;
}

/** One plain sentence for when a page check is skipped because the browser is missing. */
export const MISSING_SENTENCE = '这一轮没有截图：这台电脑还没有浏览器组件。源码检查照常完成；需要截图时点"开始检测"，按提示同意下载即可（命令行可运行 uxqa browser install）。';
