import { chromium, type Browser } from 'playwright';
import type { ProjectEntry } from './store.js';

const previews = new Map<string, Browser>();
const properties = new Set(['color', 'background-color', 'border-color', 'border-radius', 'border-width', 'border-style', 'box-shadow', 'opacity', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'gap', 'display', 'flex-direction', 'align-items', 'justify-content', 'grid-template-columns', 'width', 'max-width', 'min-height']);

export function agentPreviewActive(id: string): boolean { return previews.has(id); }
export function agentPreviewPages(id: string) { return previews.get(id)?.contexts().flatMap((context) => context.pages()) ?? []; }

export function registerAgentPreview(id: string, browser: Browser): void {
  previews.set(id, browser);
  browser.on('disconnected', () => { if (previews.get(id) === browser) previews.delete(id); });
}

export async function closeAgentPreview(id: string): Promise<void> {
  const browser = previews.get(id);
  previews.delete(id);
  await browser?.close();
}

export async function closeAgentPreviews(): Promise<void> {
  await Promise.all([...previews.keys()].map(closeAgentPreview));
}

/** Preview bounded DOM changes against a running project, without writing its files. */
export async function openAgentPreviews(entry: ProjectEntry, input: { route: unknown; selector: unknown; variants: unknown }, options: { headless?: boolean; signal?: AbortSignal } = {}) {
  if (previews.has(entry.id)) throw new Error('当前项目的方案预览仍在打开，请先关闭预览');
  if (!entry.pages?.baseUrl) throw new Error('请先为项目设置页面预览地址');
  if (typeof input.route !== 'string' || !input.route.startsWith('/') || input.route.startsWith('//')) throw new Error('请提供当前项目内的页面路径');
  if (typeof input.selector !== 'string' || !input.selector.trim() || input.selector.length > 500) throw new Error('请提供要比较的页面元素选择器');
  if (!Array.isArray(input.variants) || input.variants.length < 2 || input.variants.length > 3) throw new Error('请提供两个或三个可比较的方案');
  const variants = input.variants.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('方案格式无效');
    const variant = value as { name?: unknown; styles?: unknown; changes?: unknown; moves?: unknown };
    if (typeof variant.name !== 'string' || !variant.name.trim() || variant.name.length > 60) throw new Error('方案需要名称和样式');
    if (variant.changes !== undefined && (!Array.isArray(variant.changes) || variant.changes.length > 10)) throw new Error('方案元素修改格式无效');
    if (variant.moves !== undefined && (!Array.isArray(variant.moves) || variant.moves.length > 10)) throw new Error('方案元素移动格式无效');
    const rawChanges = [...(variant.styles === undefined ? [] : [{ selector: input.selector, styles: variant.styles }]), ...((variant.changes ?? []) as unknown[])];
    const changes = rawChanges.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('方案元素修改格式无效');
      const change = raw as { selector?: unknown; styles?: unknown; text?: unknown };
      if (typeof change.selector !== 'string' || !change.selector.trim() || change.selector.length > 500 || (change.styles === undefined && change.text === undefined)) throw new Error('方案元素修改格式无效');
      if (change.text !== undefined && (typeof change.text !== 'string' || change.text.length > 1000)) throw new Error('方案元素文字无效');
      if (change.styles !== undefined && (!change.styles || typeof change.styles !== 'object' || Array.isArray(change.styles))) throw new Error('方案包含不支持的样式');
      const declarations = Object.entries(change.styles ?? {});
      if (declarations.length > 20 || declarations.some(([key, item]) => !properties.has(key) || typeof item !== 'string' || !item.trim() || item.length > 200 || /[;{}@\\]|url\s*\(|expression\s*\(/i.test(item))) throw new Error('方案包含不支持的样式');
      return { selector: change.selector, styles: Object.fromEntries(declarations) as Record<string, string>, ...(change.text !== undefined ? { text: change.text as string } : {}) };
    });
    const moves = ((variant.moves ?? []) as unknown[]).map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('方案元素移动格式无效');
      const move = raw as { selector?: unknown; destination?: unknown; position?: unknown };
      if (typeof move.selector !== 'string' || !move.selector.trim() || move.selector.length > 500 || typeof move.destination !== 'string' || !move.destination.trim() || move.destination.length > 500 || !['before', 'after', 'prepend', 'append'].includes(String(move.position))) throw new Error('方案元素移动格式无效');
      return { selector: move.selector, destination: move.destination, position: move.position as 'before' | 'after' | 'prepend' | 'append' };
    });
    if (!changes.length && !moves.length) throw new Error('方案需要名称和样式');
    return { name: variant.name.trim(), changes, moves };
  });
  const base = new URL(entry.pages.baseUrl), target = new URL(input.route, base);
  if (!['http:', 'https:'].includes(target.protocol) || target.origin !== base.origin) throw new Error('只能预览当前项目的地址');
  const browser = await chromium.launch({ headless: options.headless ?? false });
  const cancel = () => { void browser.close().catch(() => undefined); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    options.signal?.throwIfAborted();
    const definitions = [{ name: 'Original', changes: [], moves: [] }, ...variants];
    for (const variant of definitions) {
      options.signal?.throwIfAborted();
      const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'block', ...(entry.pages.storageState ? { storageState: entry.pages.storageState } : {}) });
      await context.routeWebSocket('**/*', (socket) => socket.close());
      await context.route('**/*', (route) => {
        const request = route.request();
        const otherOrigin = request.isNavigationRequest() && new URL(request.url()).origin !== base.origin;
        return otherOrigin || !['GET', 'HEAD'].includes(request.method()) ? route.abort() : route.continue();
      });
      const page = await context.newPage();
      page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => undefined); });
      const response = await page.goto(target.href, { waitUntil: 'load', timeout: 20_000 });
      if (!response || response.status() >= 400 || new URL(page.url()).origin !== base.origin) throw new Error('页面未能在项目预览地址打开');
      const selected = page.locator(input.selector);
      if (await selected.count() !== 1) throw new Error('选择器需要准确匹配一个页面元素');
      await selected.waitFor({ state: 'visible', timeout: 5_000 });
      const previewError = await page.evaluate(({ changes, moves }) => {
        try {
          const single = (selector: string) => {
            let elements: NodeListOf<Element>;
            try { elements = document.querySelectorAll(selector); } catch { throw new Error('方案选择器无效'); }
            if (elements.length !== 1) throw new Error('方案中的每个选择器需要准确匹配一个页面元素');
            return elements[0] as HTMLElement;
          };
          const targets = changes.map((change) => ({ ...change, element: single(change.selector) }));
          const positions = moves.map((move) => ({ ...move, element: single(move.selector), target: single(move.destination) }));
          for (const change of targets) {
            if (change.text !== undefined && change.element.childElementCount) throw new Error('只能临时修改不含子元素的文字');
            for (const [property, value] of Object.entries(change.styles)) if (!CSS.supports(property, value)) throw new Error('方案包含浏览器不支持的样式');
          }
          for (const move of positions) {
            if (move.element.contains(move.target) || ((move.position === 'before' || move.position === 'after') && !move.target.parentElement)) throw new Error('方案元素不能移动到该位置');
            if (move.position === 'before') move.target.before(move.element);
            else if (move.position === 'after') move.target.after(move.element);
            else if (move.position === 'prepend') move.target.prepend(move.element);
            else move.target.append(move.element);
          }
          for (const change of targets) {
            if (change.text !== undefined) change.element.textContent = change.text;
            for (const [property, value] of Object.entries(change.styles)) change.element.style.setProperty(property, value, 'important');
          }
          return null;
        } catch (error) { return error instanceof Error ? error.message : '方案预览未完成'; }
      }, { changes: variant.changes, moves: variant.moves });
      if (previewError) throw new Error(previewError);
      await page.evaluate((name) => { document.title = `UXQA · ${name} · ${document.title}`; }, variant.name);
    }
    registerAgentPreview(entry.id, browser);
    return { status: 'running' as const, route: target.pathname + target.search, selector: input.selector, variants: definitions.map((variant) => variant.name), proposals: variants, viewport: { width: 1200, height: 800 }, limitations: '各方案在独立浏览器上下文中临时修改现有元素，不写入项目；框架重渲染可能撤销修改。写请求和 WebSocket 已阻止，部分交互可能不可用；GET 也可能产生副作用，请使用测试环境。' };
  } catch (error) { await browser.close().catch(() => undefined); throw error; }
  finally { options.signal?.removeEventListener('abort', cancel); }
}
