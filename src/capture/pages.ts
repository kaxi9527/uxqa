import type { PageReuse, PageView } from '../visual/audit.js';
import type { ViewChange } from '../visual/compare.js';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { Locator, Violation } from '../check/run.js';

export interface PageTarget {
  baseUrl: string;
  routes: string[];
  storageState?: string;
  /** Follow same-origin links from the first page to find more pages (bounded). */
  discover?: boolean;
  viewport?: { width: number; height: number };
}

export interface Shot { route: string; viewport: string; crop: string; full: string; matches: number }

export interface Capture {
  /** A box in screenshot pixels drawn by the console over the image (used for problems found by looking at screenshots). */
  mark?: { x: number; y: number; width: number; height: number };
  /** Number drawn on the screenshots; matches the problem's position in this round's list. */
  number?: number;
  status: 'found' | 'multiple' | 'not-found' | 'not-locatable';
  /** Why there is no screenshot, so the card can offer the right next step. */
  reason?: 'login-required' | 'preview-down' | 'file-not-opened' | 'hidden' | 'code-only';
  /** Plain-language explanation shown on the card. */
  note: string;
  shots: Shot[];
  matches: number;
}

export interface CapturedPage { route: string; url: string; status: 'ok' | 'failed' | 'login' | 'blank'; error?: string; screenshot?: string; problems: number; /** Whether the page revealed which source files it loaded (development server). */ modulesKnown?: boolean }

export interface CaptureReport {
  /** Whole-screen page screenshots kept for review by a vision model or the user's AI agent. */
  views?: PageView[];
  /** The same pages compared with the previous round (how much of each changed). */
  changes?: ViewChange[];
  /** Per page: how many of the controls the library covers actually come from the library. */
  reuse?: PageReuse[];
  baseUrl: string;
  viewport: string;
  pages: CapturedPage[];
  captures: Record<string, Capture>;
  cancelled: boolean;
  durationMs: number;
}

export type Progress = (step: { done: number; total: number; message: string }) => void;

const MAX_PROBLEMS = 300;
const MAX_SHOTS_PER_PROBLEM = 3;
const MAX_DISCOVERED = 12;

function safe(value: string): string {
  return `${value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page'}-${createHash('sha256').update(value).digest('hex').slice(0, 6)}`;
}

/** Which problems can be looked for on a page at all, and why not otherwise. */
export function locatable(violation: Violation): { ok: true; locate: Locator } | { ok: false; note: string } {
  const locate = violation.locate;
  if (!locate) return { ok: false, note: violation.title === '重复了' ? '这是组件定义的问题，页面上看不出区别，下面是对应的代码。' : '这类问题写在样式代码里，页面上没法单独圈出来，下面是对应的代码。' };
  if (locate.token) return { ok: true, locate };
  if ((locate.classes?.length ?? 0) >= 1 || locate.text || locate.role) return { ok: true, locate };
  return { ok: false, note: '这个元素没有样式类名也没有文字，特征太少，没法在页面上确定是哪一个，下面是对应的代码。' };
}

interface Box { x: number; y: number; width: number; height: number }

/**
 * In-page code is kept as plain JavaScript text so no bundler or loader helper (e.g. `__name`) leaks into the page.
 * FIND: visible elements matching each locator, in document coordinates.
 */
const FIND_SCRIPT = `(locators) => {
  const result = {};
  const normalize = (text) => (text || '').replace(/\\s+/g, ' ').trim();
  for (const { key, locate } of locators) {
    const pool = locate.token
      ? [...document.querySelectorAll('[class]')].filter((element) => element.classList.contains(locate.token))
      : [...document.querySelectorAll(locate.tag || '*')];
    const candidates = pool.filter((element) => {
      if (locate.tag && element.tagName.toLowerCase() !== locate.tag) return false;
      if (locate.role && element.getAttribute('role') !== locate.role) return false;
      if (locate.inputType && (element.getAttribute('type') || 'text') !== locate.inputType) return false;
      // Class-merging helpers can drop a few classes at runtime: most of them (70%) must still be there.
      if (locate.classes && locate.classes.length) {
        const present = locate.classes.filter((name) => element.classList.contains(name)).length;
        if (present / locate.classes.length < 0.7) return false;
      }
      if (locate.text && !normalize(element.textContent).includes(locate.text)) return false;
      return true;
    });
    const boxes = [];
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width < 1 || rect.height < 1 || style.visibility === 'hidden' || style.display === 'none') continue;
      boxes.push({ x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height });
      if (boxes.length >= 20) break;
    }
    result[key] = boxes;
  }
  return result;
}`;

/** Source files the page loaded. A development server serves every module separately; a production build does not. */
const RESOURCES_SCRIPT = `() => performance.getEntriesByType('resource').map((entry) => entry.name)`;

function loadedModules(names: string[]): { known: boolean; paths: string[] } {
  const paths = names.flatMap((name) => { try { return [decodeURIComponent(new URL(name).pathname)]; } catch { return []; } });
  return { known: paths.some((path) => /\.(tsx|jsx|vue|svelte)$/.test(path) || /\/src\/.+\.(ts|js)$/.test(path)), paths };
}

/** DRAW: numbered frames above everything; REMOVE takes them away again after the screenshot. */
const DRAW_SCRIPT = `(frames) => {
  const layer = document.createElement('div');
  layer.setAttribute('data-uxqa-overlay', '');
  layer.setAttribute('style', 'position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;');
  for (const { box, label } of frames) {
    const frame = document.createElement('div');
    frame.setAttribute('style', 'position:absolute!important;left:' + (box.x - 4) + 'px!important;top:' + (box.y - 4) + 'px!important;width:' + (box.width + 8) + 'px!important;height:' + (box.height + 8) + 'px!important;border:3px solid #e5484d!important;border-radius:6px!important;box-sizing:border-box!important;background:rgba(229,72,77,.08)!important;');
    layer.append(frame);
  }
  document.body.append(layer);
  // Number tags: shift right until they no longer cover an earlier tag.
  const placed = [];
  for (const { box, label } of frames) {
    const tag = document.createElement('div');
    tag.textContent = label;
    const top = Math.max(0, box.y - 26);
    let left = Math.max(0, box.x - 4);
    const style = (x) => 'position:absolute!important;left:' + x + 'px!important;top:' + top + 'px!important;background:#e5484d!important;color:#fff!important;font:600 12px/20px system-ui,sans-serif!important;padding:0 7px!important;border-radius:4px!important;white-space:nowrap!important;';
    tag.setAttribute('style', style(left));
    layer.append(tag);
    const width = tag.getBoundingClientRect().width || 24;
    for (let guard = 0; guard < 40 && placed.some((other) => Math.abs(other.top - top) < 22 && left < other.left + other.width + 2 && left + width + 2 > other.left); guard++) left += width + 4;
    tag.setAttribute('style', style(left));
    placed.push({ left, top, width });
  }
}`;
const REMOVE_SCRIPT = `() => { for (const layer of document.querySelectorAll('[data-uxqa-overlay]')) layer.remove(); }`;

function inPage<T>(page: Page, script: string, argument?: unknown): Promise<T> {
  return page.evaluate(`(${script})(${argument === undefined ? '' : JSON.stringify(argument)})`) as Promise<T>;
}

async function discoverRoutes(page: Page, baseUrl: string, start: string[]): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const links = await inPage<string[]>(page, "() => [...document.querySelectorAll('a[href]')].map((anchor) => anchor.href)").catch(() => [] as string[]);
  const routes = new Set(start);
  for (const link of links) {
    try {
      const url = new URL(link);
      if (url.origin !== origin || /\.(png|jpe?g|svg|pdf|zip|csv)$/i.test(url.pathname)) continue;
      routes.add(`${url.pathname}${url.search}`);
    } catch { /* ignore malformed */ }
    if (routes.size >= MAX_DISCOVERED) break;
  }
  return [...routes];
}

export async function capturePages(violations: Violation[], target: PageTarget, outDir: string, options: { progress?: Progress; signal?: AbortSignal } = {}): Promise<CaptureReport> {
  const started = Date.now();
  const viewport = target.viewport ?? { width: 1440, height: 900 };
  const viewportName = `${viewport.width}×${viewport.height}`;
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const problems = violations.filter((violation) => violation.status === 'new').slice(0, MAX_PROBLEMS);
  const captures: Record<string, Capture> = {};
  const wanted: Array<{ key: string; locate: Locator; number: number; file: string }> = [];
  problems.forEach((violation, index) => {
    const check = locatable(violation);
    if (!check.ok) { captures[violation.fingerprint] = { number: index + 1, status: 'not-locatable', reason: 'code-only', note: check.note, shots: [], matches: 0 }; return; }
    wanted.push({ key: violation.fingerprint, locate: check.locate, number: index + 1, file: violation.file });
  });
  const totals = new Map<string, number>();
  const shots = new Map<string, Shot[]>();
  const pages: CapturedPage[] = [];
  let routes = target.routes.length ? [...target.routes] : ['/'];
  let browser: Browser | undefined;
  let cancelled = false;
  let anyModulesKnown = false;
  const loadedSomewhere = new Set<string>();
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport, ...(target.storageState ? { storageState: target.storageState } : {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    for (let index = 0; index < routes.length; index++) {
      if (options.signal?.aborted) { cancelled = true; break; }
      const route = routes[index];
      const url = new URL(route, target.baseUrl).toString();
      options.progress?.({ done: index, total: routes.length, message: `正在打开页面 ${route}` });
      try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
        const status = response?.status() ?? 200;
        await page.waitForTimeout(800);
        // A page that bounces to a login screen (or answers 401/403) cannot show its problems without a login state.
        const landed = new URL(page.url());
        if (status === 401 || status === 403 || (landed.pathname !== new URL(url).pathname && /log-?in|sign-?in|oauth|\/auth\b|\/auth\//i.test(`${landed.pathname}${landed.search}`))) {
          pages.push({ route, url, status: 'login', error: `需要登录（打开后跳到了 ${landed.pathname}）`, problems: 0 });
          continue;
        }
        if (status >= 400) throw new Error(`页面返回 ${status}`);
        const empty = await inPage<boolean>(page, "() => !document.body || (document.body.innerText.trim().length === 0 && !document.querySelector('img,svg,canvas,video'))").catch(() => false);
        if (empty) {
          pages.push({ route, url, status: 'blank', error: '页面是空白的，可能还在加载、出错了，或者需要登录', problems: 0 });
          continue;
        }
        if (target.discover && index === 0) routes = await discoverRoutes(page, target.baseUrl, routes);
        const modules = loadedModules(await inPage<string[]>(page, RESOURCES_SCRIPT).catch(() => [] as string[]));
        if (modules.known) anyModulesKnown = true;
        // On a development server, only problems whose file this page actually loaded can be on it.
        const onThisPage = modules.known ? wanted.filter((item) => modules.paths.some((path) => path.endsWith(`/${item.file}`))) : wanted;
        for (const item of onThisPage) loadedSomewhere.add(item.key);
        const found = await inPage<Record<string, Box[]>>(page, FIND_SCRIPT, onThisPage.map(({ key, locate }) => ({ key, locate })));
        const label = safe(route);
        const frames: Array<{ box: Box; label: string }> = [];
        let problemsHere = 0;
        for (const item of wanted) {
          const boxes = found[item.key] ?? [];
          if (!boxes.length) continue;
          problemsHere++;
          totals.set(item.key, (totals.get(item.key) ?? 0) + boxes.length);
          for (const box of boxes.slice(0, 5)) frames.push({ box, label: String(item.number) });
        }
        let full: string | undefined;
        if (frames.length) {
          full = join(outDir, `page-${label}.png`);
          await inPage(page, DRAW_SCRIPT, frames);
          await page.screenshot({ path: full, fullPage: true });
          await inPage(page, REMOVE_SCRIPT);
        }
        const size = await inPage<{ width: number; height: number }>(page, '() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })');
        for (const item of wanted) {
          const boxes = found[item.key] ?? [];
          const list = shots.get(item.key) ?? [];
          if (!boxes.length || list.length >= MAX_SHOTS_PER_PROBLEM) continue;
          const box = boxes[0];
          // At least 520×260 of surrounding page so a small element is shown in context; very large ones are capped.
          const width = Math.min(size.width, Math.max(520, Math.min(box.width, 960) + 96));
          const height = Math.min(size.height, Math.max(260, Math.min(box.height, 720) + 96));
          const x = Math.max(0, Math.min(size.width - width, box.x + box.width / 2 - width / 2));
          const y = Math.max(0, Math.min(size.height - height, box.y + box.height / 2 - height / 2));
          const clip = { x, y, width, height };
          if (clip.width < 2 || clip.height < 2) continue;
          const crop = join(outDir, `issue-${item.number}-${label}.png`);
          await inPage(page, DRAW_SCRIPT, boxes.slice(0, 5).map((entry) => ({ box: entry, label: String(item.number) })));
          await page.screenshot({ path: crop, clip, fullPage: true }).catch(() => undefined);
          await inPage(page, REMOVE_SCRIPT);
          list.push({ route, viewport: viewportName, crop, full: full ?? crop, matches: boxes.length });
          shots.set(item.key, list);
        }
        pages.push({ route, url, status: 'ok', ...(full ? { screenshot: full } : {}), problems: problemsHere, modulesKnown: modules.known });
      } catch (error) {
        pages.push({ route, url, status: 'failed', error: error instanceof Error ? error.message.split('\n')[0] : String(error), problems: 0 });
      }
    }
    options.progress?.({ done: routes.length, total: routes.length, message: '截图完成' });
  } finally {
    await browser?.close();
  }
  const opened = pages.filter((entry) => entry.status === 'ok').length;
  const loginPages = pages.filter((entry) => entry.status === 'login');
  const brokenPages = pages.filter((entry) => entry.status === 'failed' || entry.status === 'blank');
  const confirm = anyModulesKnown ? '按特征对应，并确认了这个文件在该页面加载过' : '按特征对应；这是打包后的页面，没法确认对应的是不是这一行代码';
  const loginText = loginPages.length ? `有 ${loginPages.length} 个页面要登录才能看到（${loginPages.slice(0, 3).map((entry) => entry.route).join('、')}${loginPages.length > 3 ? ' 等' : ''}）` : '';
  for (const item of wanted) {
    const list = shots.get(item.key) ?? [];
    const matches = totals.get(item.key) ?? 0;
    if (!list.length) {
      const name = item.file.split('/').pop();
      let reason: Capture['reason'];
      let note: string;
      if (!opened && loginPages.length) { reason = 'login-required'; note = `${loginText}。请在"页面"里提供登录状态文件，登录后就能截到图。`; }
      else if (!opened) { reason = 'preview-down'; note = `预览页面没有打开成功（${brokenPages[0]?.error ?? '原因不明'}）。请确认项目已经在本机运行（例如 npm run dev），预览地址填得对。`; }
      else if (anyModulesKnown && !loadedSomewhere.has(item.key)) {
        reason = loginPages.length ? 'login-required' : 'file-not-opened';
        note = loginPages.length
          ? `本轮打开的页面都没有用到 ${name}，${loginText}，它很可能在其中。请在"页面"里提供登录状态文件。`
          : `本轮打开的 ${opened} 个页面都没有用到 ${name}。请在"页面"里加上用到它的页面路径。`;
      } else { reason = 'hidden'; note = `打开的页面用到了 ${name}，但没找到这个元素。它可能在弹窗、菜单或需要点开的区域里，也可能要在特定数据下才出现。`; }
      captures[item.key] = { number: item.number, status: 'not-found', reason, shots: [], matches: 0, note };
    } else if (matches > 1) {
      captures[item.key] = { number: item.number, status: 'multiple', shots: list, matches, note: `页面上有 ${matches} 处符合，都已圈出：可能是这一行代码在列表里渲染了多次，也可能别处有相同写法（${confirm}）。` };
    } else {
      captures[item.key] = { number: item.number, status: 'found', shots: list, matches, note: `已在页面上圈出（${confirm}）。` };
    }
  }
  return { baseUrl: target.baseUrl, viewport: viewportName, pages, captures, cancelled, durationMs: Date.now() - started };
}
