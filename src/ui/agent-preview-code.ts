import { createHash } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import type { ProjectEntry } from './store.js';
import { agentPreviewActive, registerAgentPreview } from './agent-preview.js';
import { forbiddenAgentSegment } from './agent-paths.js';

type RequestKind = 'document' | 'script' | 'stylesheet';
type Resource = { hash: string; contentType: string; content: string; reads: string[]; requestKind: RequestKind };
export type PreviewResources = Map<string, Resource>;
type Patch = { resource: string; requestKind: 'script' | 'stylesheet'; hash: string; search: string; replace: string };
export type CodePlan = { baseUrl: string; route: string; selector: string; variants: Array<{ name: string; patches: Patch[] }> };

function previewUrl(entry: ProjectEntry, input: unknown, protectResource = false): URL {
  if (!entry.pages?.baseUrl) throw new Error('请先为项目设置页面预览地址');
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//') || input.length > 2000) throw new Error('请提供当前项目内的页面资源路径');
  const base = new URL(entry.pages.baseUrl), target = new URL(input, base);
  if (!['http:', 'https:'].includes(target.protocol) || target.origin !== base.origin || target.hash) throw new Error('只能读取当前项目的页面资源');
  if (protectResource) {
    let segments: string[];
    try { segments = decodeURIComponent(target.pathname).split(/[\\/]+/); } catch { throw new Error('请提供当前项目内的页面资源路径'); }
    if (segments.some((segment) => forbiddenAgentSegment.test(segment))) throw new Error('页面资源路径不允许访问');
  }
  return target;
}

const resourceKind = (type: string) => /^(?:text\/html|text\/css|text\/javascript|application\/(?:javascript|x-javascript))(?:\s*;|$)/i.test(type);
const executableKind = (type: string) => /^(?:text\/css|text\/javascript|application\/(?:javascript|x-javascript))(?:\s*;|$)/i.test(type);
function requestKindFor(url: URL, input: unknown): RequestKind {
  if (input === undefined) return url.pathname.endsWith('.css') ? 'stylesheet' : url.pathname.endsWith('.html') || url.pathname.endsWith('/') ? 'document' : 'script';
  if (input !== 'document' && input !== 'script' && input !== 'stylesheet') throw new Error('页面资源加载方式无效');
  return input;
}

export async function inspectPreviewResource(entry: ProjectEntry, path: unknown, offset: unknown, resources: PreviewResources, signal: AbortSignal, requestedKind?: unknown) {
  const url = previewUrl(entry, path, true), name = url.pathname + url.search;
  const requestKind = requestKindFor(url, requestedKind), key = `${requestKind}:${name}`;
  if (offset !== undefined && (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0)) throw new Error('页面资源读取位置无效');
  let response: Response;
  const accept = requestKind === 'document' ? 'text/html,application/xhtml+xml,*/*;q=0.8' : requestKind === 'stylesheet' ? 'text/css,*/*;q=0.1' : '*/*';
  try { response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), headers: { accept, 'sec-fetch-dest': requestKind === 'stylesheet' ? 'style' : requestKind } }); }
  catch (error) { if (signal.aborted) throw error; throw new Error('页面资源无法读取，请检查预览服务和登录状态'); }
  if (!response.ok || !response.body) throw new Error('页面资源无法读取，请检查预览服务和登录状态');
  const contentType = response.headers.get('content-type') ?? '';
  if (!resourceKind(contentType)) throw new Error('只能读取 HTML、脚本或样式资源');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1_000_000) throw new Error('页面资源超过读取大小限制');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = Buffer.concat(chunks);
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('页面资源不是有效的 UTF-8 文本'); }
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i.test(content)) throw new Error('页面资源包含疑似凭据，已停止发送');
  const hash = createHash('sha256').update(bytes).digest('hex'), start = offset ?? 0;
  if (start > content.length) throw new Error('页面资源读取位置无效');
  const excerpt = content.slice(start, start + 12_000);
  const previous = resources.get(key);
  resources.set(key, { hash, contentType, content, requestKind, reads: [...(previous?.hash === hash ? previous.reads : []), excerpt] });
  return { resource: name, requestKind, hash, contentType, offset: start, total: content.length, content: excerpt, nextOffset: start + excerpt.length < content.length ? start + excerpt.length : null };
}

export function prepareCodePreview(entry: ProjectEntry, input: { route: unknown; selector: unknown; variants: unknown }, resources: PreviewResources): CodePlan {
  const target = previewUrl(entry, input.route);
  if (typeof input.selector !== 'string' || !input.selector.trim() || input.selector.length > 500) throw new Error('请提供要比较的页面元素选择器');
  if (!Array.isArray(input.variants) || input.variants.length < 2 || input.variants.length > 3) throw new Error('请提供两个或三个可比较的方案');
  const names = new Set<string>();
  const variants = input.variants.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('代码方案格式无效');
    const variant = raw as { name?: unknown; patches?: unknown };
    if (typeof variant.name !== 'string' || !variant.name.trim() || variant.name.length > 60 || names.has(variant.name.trim()) || !Array.isArray(variant.patches) || !variant.patches.length || variant.patches.length > 5) throw new Error('代码方案需要不同的名称和资源修改');
    const name = variant.name.trim(), seen = new Set<string>();
    names.add(name);
    const patches = variant.patches.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('代码方案格式无效');
      const patch = value as { resource?: unknown; requestKind?: unknown; search?: unknown; replace?: unknown };
      const url = previewUrl(entry, patch.resource, true), resource = url.pathname + url.search, requestKind = requestKindFor(url, patch.requestKind), key = `${requestKind}:${resource}`;
      if (requestKind === 'document' || seen.has(key) || typeof patch.search !== 'string' || !patch.search || patch.search.length > 10_000 || typeof patch.replace !== 'string' || patch.replace.length > 20_000 || patch.replace === patch.search) throw new Error('代码方案的资源或替换内容无效');
      const search = patch.search, replace = patch.replace;
      const source = resources.get(key);
      if (!source || !executableKind(source.contentType) || !source.reads.some((chunk) => chunk.includes(search))) throw new Error('代码方案必须引用本轮实际读取的脚本或样式原文');
      const index = source.content.indexOf(search);
      if (index < 0 || source.content.indexOf(search, index + search.length) !== -1) throw new Error('代码方案原文必须在资源中唯一');
      seen.add(key);
      return { resource, requestKind, hash: source.hash, search, replace };
    });
    return { name, patches };
  });
  return { baseUrl: entry.pages!.baseUrl, route: target.pathname + target.search, selector: input.selector, variants };
}

export async function openAgentCodePreviews(entry: ProjectEntry, plan: CodePlan, options: { headless?: boolean; signal: AbortSignal }) {
  if (agentPreviewActive(entry.id)) throw new Error('当前项目的方案预览仍在打开，请先关闭预览');
  if (!entry.pages?.baseUrl || entry.pages.baseUrl !== plan.baseUrl) throw new Error('项目预览地址已变化，请重新准备方案');
  const target = previewUrl(entry, plan.route), browser: Browser = await chromium.launch({ headless: options.headless ?? false });
  const cancel = () => { void browser.close().catch(() => undefined); };
  options.signal.addEventListener('abort', cancel, { once: true });
  try {
    const results: Array<{ name: string; applied: number; runtimeErrors: number; consoleErrors: number; failedRequests: number; blockedRequests: number }> = [];
    for (const variant of [{ name: 'Original', patches: [] as Patch[] }, ...plan.variants]) {
      options.signal.throwIfAborted();
      const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
      const state = { failure: '', applied: new Set<string>(), runtimeErrors: 0, consoleErrors: 0, failedRequests: 0, blockedRequests: 0 };
      await context.routeWebSocket('**/*', (socket) => { state.blockedRequests++; socket.close(); });
      await context.route('**/*', async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== target.origin || !['GET', 'HEAD'].includes(request.method())) { state.blockedRequests++; return route.abort(); }
        const patch = variant.patches.find((item) => item.resource === url.pathname + url.search && item.requestKind === request.resourceType());
        let response: Awaited<ReturnType<typeof route.fetch>> | undefined;
        try {
          response = await route.fetch({ maxRedirects: 0, timeout: 10_000 });
          if (response.status() >= 300 && response.status() < 400) { state.blockedRequests++; return await route.abort(); }
        if (!patch) return await route.fulfill({ response });
          const contentType = response.headers()['content-type'] ?? '';
          if (!response.ok() || !executableKind(contentType)) throw new Error('预览资源响应无效');
          const bytes = await response.body();
          if (bytes.length > 1_000_000 || createHash('sha256').update(bytes).digest('hex') !== patch.hash) throw new Error('页面资源已变化，请重新准备代码方案');
          const original = new TextDecoder('utf-8', { fatal: true }).decode(bytes), index = original.indexOf(patch.search);
          if (index < 0 || original.indexOf(patch.search, index + patch.search.length) !== -1) throw new Error('代码方案原文必须在资源中唯一');
          state.applied.add(`${patch.requestKind}:${patch.resource}`);
          const body = original.slice(0, index) + patch.replace + original.slice(index + patch.search.length);
          const headers = { ...response.headers() };
          delete headers['content-length']; delete headers['content-encoding']; delete headers.etag;
          return await route.fulfill({ response, headers, body });
        } catch (error) {
          const known = ['预览资源响应无效', '页面资源已变化，请重新准备代码方案', '代码方案原文必须在资源中唯一'];
          state.failure = error instanceof Error && known.includes(error.message) ? error.message : '预览资源响应无效';
          return route.abort();
        } finally { await response?.dispose().catch(() => undefined); }
      });
      const page = await context.newPage();
      page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => undefined); });
      page.on('pageerror', () => { state.runtimeErrors++; });
      page.on('console', (item) => { if (item.type() === 'error') state.consoleErrors++; });
      page.on('requestfailed', () => { state.failedRequests++; });
      let response;
      try { response = await page.goto(target.href, { waitUntil: 'load', timeout: 20_000 }); }
      catch (error) { if (state.failure) throw new Error(state.failure); if (options.signal.aborted) throw error; throw new Error('页面未能在项目预览地址打开'); }
      if (state.failure) throw new Error(state.failure);
      if (!response || response.status() >= 400 || new URL(page.url()).origin !== target.origin) throw new Error('页面未能在项目预览地址打开');
      if (state.applied.size !== variant.patches.length) throw new Error('方案资源未在页面加载时请求，尚不能比较');
      const selected = page.locator(plan.selector);
      if (await selected.count() !== 1) throw new Error('选择器需要准确匹配一个页面元素');
      await selected.waitFor({ state: 'visible', timeout: 5_000 });
      await page.evaluate((name) => { document.title = `UXQA · ${name} · ${document.title}`; }, variant.name);
      results.push({ name: variant.name, applied: state.applied.size, runtimeErrors: state.runtimeErrors, consoleErrors: state.consoleErrors, failedRequests: state.failedRequests, blockedRequests: state.blockedRequests });
    }
    options.signal.throwIfAborted();
    registerAgentPreview(entry.id, browser);
    return { status: results.some((result) => result.runtimeErrors || result.consoleErrors || result.failedRequests) ? 'opened-with-errors' as const : 'opened' as const, route: plan.route, selector: plan.selector, variants: results, proposals: plan.variants, limitations: '预览在未导入登录状态的独立浏览器中运行候选脚本；常规跨域、重定向、写请求和 WebSocket 被阻止，但 GET 仍可能改变数据，浏览器并非安全沙箱。请使用可信测试环境。预览不修改项目源码，也不代表全部交互已验证。' };
  } catch (error) { await browser.close().catch(() => undefined); throw error; }
  finally { options.signal.removeEventListener('abort', cancel); }
}
