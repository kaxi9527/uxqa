import { chromium, type Browser, type CDPSession } from 'playwright';
import type { ProjectEntry } from './store.js';

/** An observational browser sample, not a device benchmark or a performance verdict. */
export async function measureAgentMotion(entry: ProjectEntry, input: { route: unknown; selector: unknown; trigger?: unknown; allowClick?: boolean; reducedMotion?: unknown }, signal: AbortSignal) {
  if (!entry.pages?.baseUrl) throw new Error('请先为项目设置页面预览地址');
  if (typeof input.route !== 'string' || !input.route.startsWith('/') || input.route.startsWith('//')) throw new Error('请提供当前项目内的页面路径');
  if (typeof input.selector !== 'string' || !input.selector.trim() || input.selector.length > 500) throw new Error('请提供要观察的页面元素选择器');
  const trigger = input.trigger === undefined ? 'hover' : input.trigger;
  if (trigger !== 'hover' && trigger !== 'focus' && trigger !== 'click' && trigger !== 'idle' && trigger !== 'scroll') throw new Error('不支持这种动效触发方式');
  if (trigger === 'click' && !input.allowClick) throw new Error('点击测量需要在对话中启用页面点击');
  if (input.reducedMotion !== undefined && typeof input.reducedMotion !== 'boolean') throw new Error('减少动态效果选项无效');
  const reducedMotion = input.reducedMotion === true;
  const base = new URL(entry.pages.baseUrl);
  const target = new URL(input.route, base);
  if (!['http:', 'https:'].includes(target.protocol) || target.origin !== base.origin) throw new Error('只能测量当前项目的预览地址');
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const cancel = () => { void browser?.close().catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference', serviceWorkers: 'block', ...(entry.pages.storageState ? { storageState: entry.pages.storageState } : {}) });
      await context.routeWebSocket('**/*', (socket) => socket.close());
      await context.route('**/*', (route) => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
      const page = await context.newPage();
      page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => undefined); });
      const response = await page.goto(target.href, { waitUntil: 'load', timeout: 20_000 });
      if (!response || response.status() >= 400 || new URL(page.url()).origin !== base.origin) throw new Error('页面未能在项目预览地址打开');
      const locator = page.locator(input.selector);
      if (await locator.count() !== 1) throw new Error('选择器需要准确匹配一个页面元素');
      await locator.waitFor({ state: 'visible', timeout: 5_000 });
      await page.mouse.move(0, 0);
      if (trigger === 'scroll') {
        try { await locator.hover({ timeout: 5_000 }); }
        catch (error) { if (signal.aborted) throw error; throw new Error('无法在可见、稳定且未遮挡的元素上完成动效触发，请检查页面状态和选择器'); }
      }
      const scrollPosition = async () => locator.evaluate((element) => {
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return { container: 'ancestor', top: parent.scrollTop };
        }
        return { container: 'window', top: window.scrollY };
      });
      const scrollBefore = trigger === 'scroll' ? await scrollPosition() : null;
      let cdp: CDPSession | undefined;
      let before: Map<string, number> | null = null;
      try { cdp = await context.newCDPSession(page); await cdp.send('Performance.enable'); before = new Map((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value])); } catch { /* Browser counters are optional evidence. */ }
      const sampling = page.evaluate((selector) => new Promise<{ durationMs: number; intervals: number[]; longTasks: number[]; observedAnimations: number; targetAnimations: number | null; longTasksSupported: boolean; visibility: string }>((done) => {
        const start = performance.now(), intervals: number[] = [], longTasks: number[] = [];
        let previous = 0, observedAnimations = 0, targetAnimations: number | null = 0;
        const target = document.querySelector(selector);
        const longTasksSupported = PerformanceObserver.supportedEntryTypes.includes('longtask');
        const observer = longTasksSupported ? new PerformanceObserver((list) => { for (const task of list.getEntries()) longTasks.push(task.duration); }) : null;
        observer?.observe({ entryTypes: ['longtask'] });
        const frame = (at: number) => {
          if (previous) intervals.push(at - previous);
          previous = at;
          observedAnimations = Math.max(observedAnimations, document.getAnimations().filter((animation) => animation.playState === 'running').length);
          if (!target?.isConnected) targetAnimations = null;
          else if (targetAnimations !== null) targetAnimations = Math.max(targetAnimations, target.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length);
          if (performance.now() - start < 1200) requestAnimationFrame(frame);
          else { observer?.disconnect(); done({ durationMs: performance.now() - start, intervals, longTasks, observedAnimations, targetAnimations, longTasksSupported, visibility: document.visibilityState }); }
        };
        requestAnimationFrame(frame);
      }), input.selector);
      try {
        if (trigger === 'hover') await locator.hover({ timeout: 5_000 });
        else if (trigger === 'focus') await locator.focus({ timeout: 5_000 });
        else if (trigger === 'click') await locator.click({ timeout: 5_000 });
        else if (trigger === 'scroll') await page.mouse.wheel(0, 400);
      }
      catch (error) {
        await sampling.catch(() => undefined);
        if (signal.aborted) throw error;
        throw new Error('无法在可见、稳定且未遮挡的元素上完成动效触发，请检查页面状态和选择器');
      }
      const sample = await sampling;
      if (sample.intervals.length < 2) throw new Error('浏览器没有提供足够的帧回调，测量未完成');
      const scrollAfter = trigger === 'scroll' ? await scrollPosition() : null;
      if (scrollBefore && scrollAfter && (scrollBefore.container !== scrollAfter.container || scrollBefore.top === scrollAfter.top)) throw new Error('没有观察到实际滚动，测量未完成');
      let mainThread: { taskMs: number; scriptMs: number; layoutMs: number; styleMs: number; layoutCount: number; styleCount: number } | null = null;
      try {
        if (before && cdp) {
          const after = new Map((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]));
          const keys = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
          if (keys.every((key) => before!.has(key) && after.has(key))) {
            const delta = (key: string, multiplier = 1) => Number(((after.get(key)! - before!.get(key)!) * multiplier).toFixed(2));
            mainThread = { taskMs: delta('TaskDuration', 1000), scriptMs: delta('ScriptDuration', 1000), layoutMs: delta('LayoutDuration', 1000), styleMs: delta('RecalcStyleDuration', 1000), layoutCount: delta('LayoutCount'), styleCount: delta('RecalcStyleCount') };
          }
        }
      } catch { /* Preserve the observed frame sample if browser counters are unavailable. */ }
      const sorted = [...sample.intervals].sort((a, b) => a - b);
      return { status: 'measured' as const, route: target.pathname + target.search, selector: input.selector, trigger, reducedMotion, browser: `Chromium ${browser.version()}`, viewport: { width: 1440, height: 900 }, durationMs: Math.round(sample.durationMs), frameIntervals: sample.intervals.length, medianFrameMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)), p95FrameMs: Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(2)), longestFrameMs: Number(sorted.at(-1)!.toFixed(2)), longTasks: sample.longTasksSupported ? sample.longTasks.map((duration) => Number(duration.toFixed(2))) : null, observedAnimations: sample.observedAnimations, targetAnimations: sample.targetAnimations, mainThread, scroll: scrollBefore && scrollAfter ? { container: scrollBefore.container, delta: Number((scrollAfter.top - scrollBefore.top).toFixed(2)) } : null, visibility: sample.visibility, limitations: '浏览器帧回调、长任务及主线程计数包含采样开销，不等于实际掉帧、GPU 或真实设备性能，也不构成通过结论；只覆盖本次指定的触发场景。' };
    } finally { signal.removeEventListener('abort', cancel); }
  } finally { await browser?.close().catch(() => undefined); }
}
