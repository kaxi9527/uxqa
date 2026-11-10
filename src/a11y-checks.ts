import type { Page } from 'playwright';

/**
 * Browser-side heuristics for the parts of the accessibility baseline that axe does not cover.
 * They report evidence and clear failures; judgement items (logical order, acceptable motion)
 * stay `not-verified` for a human.
 */

export interface FocusStop {
  index: number;
  element: string;
  name: string;
  indicator: 'visible' | 'none' | 'unknown';
  obscured: boolean;
}

export interface KeyboardResult {
  stops: FocusStop[];
  complete: boolean;
  trapped?: string;
  missingIndicator: FocusStop[];
  obscured: FocusStop[];
  unfocusableControls: string[];
}

const BASELINE_KEY = '__uxqaFocusBaseline';

export async function traverseKeyboard(page: Page, maxStops: number): Promise<KeyboardResult> {
  // Record unfocused styles first so a focus indicator can be detected without blurring page controls.
  const unfocusableControls = await page.evaluate((key) => {
    const describe = (element: Element) => {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : '';
      const classes = typeof element.className === 'string' && element.className.trim() ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      return `${tag}${id}${classes}`;
    };
    const props = ['outline-style', 'outline-width', 'outline-color', 'outline-offset', 'box-shadow', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'background-color', 'color', 'text-decoration-line', 'transform'];
    const snapshot = (element: Element) => {
      const read = (pseudo?: string) => { const style = getComputedStyle(element, pseudo); return props.map((prop) => style.getPropertyValue(prop)).join('|'); };
      return [read(), read('::before'), read('::after'), element.parentElement ? props.map((prop) => getComputedStyle(element.parentElement!).getPropertyValue(prop)).join('|') : ''].join('§');
    };
    // Baselines must be taken unfocused: an element focused on load (autofocus, an opened dialog) would otherwise
    // look "unchanged" when Tab reaches it.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const baseline = new WeakMap<Element, string>();
    const focusable = document.querySelectorAll('a[href],button,input,select,textarea,summary,iframe,[tabindex],[contenteditable="true"]');
    let captured = 0;
    for (const element of focusable) { if (captured++ > 600) break; baseline.set(element, snapshot(element)); }
    (window as unknown as Record<string, unknown>)[key] = { baseline, snapshot };
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const native = 'a[href],button,input,select,textarea,summary,iframe,[contenteditable="true"]';
    return [...document.querySelectorAll('[role="button"],[role="link"],[role="checkbox"],[role="switch"],[role="tab"],[role="menuitem"],[role="radio"]')]
      .filter((element) => !element.matches(native) && !element.hasAttribute('tabindex') && element.getAttribute('aria-disabled') !== 'true' && !element.closest('[aria-activedescendant]') && visible(element))
      .slice(0, 20)
      .map((element) => `${describe(element)} role=${element.getAttribute('role')} "${(element.textContent ?? '').trim().slice(0, 40)}"`);
  }, BASELINE_KEY);

  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); window.scrollTo(0, 0); });
  const stops: FocusStop[] = [];
  let complete = false;
  let trapped: string | undefined;
  let previous: string | undefined;
  let repeats = 0;
  for (let index = 0; index < maxStops; index++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(30);
    const info = await page.evaluate((key) => {
      let active: Element | null = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (!active || active === document.body || active === document.documentElement) return undefined;
      const path = (element: Element) => {
        const parts: string[] = [];
        for (let node: Element | null = element; node && node !== document.documentElement && parts.length < 6; node = node.parentElement) {
          const parent: Element | null = node.parentElement;
          const same = parent ? [...parent.children].filter((child) => child.tagName === node!.tagName) : [];
          parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ''}`);
          if (node.id) break;
        }
        return parts.join(' > ');
      };
      const name = (active.getAttribute('aria-label') ?? active.getAttribute('title') ?? active.getAttribute('placeholder') ?? (active as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const state = (window as unknown as Record<string, { baseline: WeakMap<Element, string>; snapshot: (element: Element) => string }>)[key];
      const before = state?.baseline.get(active);
      const style = getComputedStyle(active);
      const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const indicator = active.tagName === 'IFRAME' ? 'unknown' : before === undefined ? (hasOutline ? 'visible' : 'unknown') : before !== state.snapshot(active) ? 'visible' : 'none';
      const rect = active.getBoundingClientRect();
      const points = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]].map(([x, y]) => [rect.left + rect.width * x, rect.top + rect.height * y]);
      const reachable = points.some(([x, y]) => {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        const top = document.elementFromPoint(x, y);
        return !!top && (top === active || active!.contains(top) || top.contains(active!));
      });
      return { element: path(active), name, indicator, obscured: rect.width > 0 && rect.height > 0 && !reachable };
    }, BASELINE_KEY);
    if (!info) {
      if (stops.length > 0) { complete = true; break; }
      continue;
    }
    if (stops.length > 0 && info.element === stops[0].element && index > 0) { complete = true; break; }
    if (info.element === previous) {
      repeats++;
      if (repeats >= 2) { trapped = info.element; break; }
      continue;
    }
    repeats = 0;
    previous = info.element;
    stops.push({ index: stops.length + 1, ...info } as FocusStop);
  }
  await page.evaluate((key) => { delete (window as unknown as Record<string, unknown>)[key]; }, BASELINE_KEY).catch(() => undefined);
  return {
    stops, complete, ...(trapped ? { trapped } : {}),
    missingIndicator: stops.filter((stop) => stop.indicator === 'none'),
    obscured: stops.filter((stop) => stop.obscured),
    unfocusableControls,
  };
}

export interface ReflowResult {
  width: number;
  scrollWidth: number;
  overflow: boolean;
  offenders: string[];
  clippedText: string[];
}

export async function measureReflow(page: Page, exceptions: string[]): Promise<ReflowResult> {
  return page.evaluate((excluded) => {
    const width = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
    const describe = (element: Element) => {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : '';
      const classes = typeof element.className === 'string' && element.className.trim() ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      return `${tag}${id}${classes}`;
    };
    const isExcluded = (element: Element) => excluded.some((selector) => { try { return !!element.closest(selector); } catch { return false; } });
    const scrollsHorizontally = (element: Element) => {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth) return true;
      }
      return false;
    };
    const shown = (element: Element) => {
      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.position !== 'fixed' && element.getAttribute('aria-hidden') !== 'true' && !element.closest('[aria-hidden="true"],[inert]');
    };
    const offenders: string[] = [];
    const clippedText: string[] = [];
    for (const element of document.body?.querySelectorAll('*') ?? []) {
      if (offenders.length >= 10 && clippedText.length >= 10) break;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.right <= width + 1 || !shown(element) || isExcluded(element) || scrollsHorizontally(element)) continue;
      const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0);
      const childOverflows = [...element.children].some((child) => child.getBoundingClientRect().right > width + 1);
      if (!childOverflows && offenders.length < 10) offenders.push(`${describe(element)} (right ${Math.round(rect.right)}px)`);
      if (ownText && rect.left < width && clippedText.length < 10) clippedText.push(`${describe(element)} "${(element.textContent ?? '').trim().slice(0, 40)}"`);
    }
    const overflow = scrollWidth > width + 1 && offenders.length > 0;
    return { width, scrollWidth, overflow, offenders: overflow ? offenders : [], clippedText };
  }, exceptions);
}

export interface MotionResult {
  persistent: string[];
  autoplayVideos: number;
}

export async function measureMotion(page: Page): Promise<MotionResult> {
  return page.evaluate(() => {
    const describe = (target: Element | null | undefined) => target ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}` : 'document';
    const persistent = document.getAnimations()
      .filter((animation) => animation.playState === 'running')
      .filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        const end = Number(timing?.endTime ?? 0);
        return timing?.iterations === Infinity || end > 5000;
      })
      .slice(0, 20)
      .map((animation) => {
        const named = animation as Animation & { animationName?: string; transitionProperty?: string };
        const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
        return `${named.animationName ?? named.transitionProperty ?? animation.constructor.name} on ${describe(target)}`;
      });
    const autoplayVideos = [...document.querySelectorAll('video')].filter((video) => !video.paused && video.autoplay).length;
    return { persistent, autoplayVideos };
  });
}
