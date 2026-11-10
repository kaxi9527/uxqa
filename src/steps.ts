import type { Page } from 'playwright';
import { matchesUrl } from './glob.js';
import { resolveTarget } from './locator.js';
import type { Step } from './types.js';

export interface StepContext {
  /** Requests observed since the flow started (method upper-case, absolute URL). */
  requests: Array<{ method: string; url: string }>;
  timeoutMs?: number;
}

const LIVE_REGION = '[role="status"],[role="alert"],[role="log"],[aria-live="polite"],[aria-live="assertive"],output';

async function poll<T>(read: () => Promise<T>, accept: (value: T) => boolean, describe: (value: T) => string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!accept(last)) {
    if (Date.now() >= deadline) throw new Error(describe(last));
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await read();
  }
}

export async function executeStep(page: Page, step: Step, context?: StepContext): Promise<void> {
  const timeout = context?.timeoutMs ?? 8000;
  switch (step.action) {
    case 'keyboard': await page.keyboard.press(step.key); return;
    case 'expectUrl':
      await poll(async () => page.url(), (url) => matchesUrl(step.url, url), (url) => `Expected URL ${step.url}, got ${url}`, timeout);
      return;
    case 'expectAnnounced':
      await poll(
        async () => page.locator(LIVE_REGION).allInnerTexts().catch(() => [] as string[]),
        (texts) => texts.some((text) => text.includes(step.text)),
        (texts) => `Expected live region (status/alert/aria-live) to announce "${step.text}", found ${texts.length ? texts.map((text) => JSON.stringify(text.trim().slice(0, 80))).join(', ') : 'no live region text'}`,
        timeout,
      );
      return;
    case 'expectRequestCount': {
      if (!context) throw new Error('expectRequestCount is only available in uxqa run flows');
      const count = () => context.requests.filter((request) => (!step.method || request.method === step.method) && matchesUrl(step.match, request.url)).length;
      const label = `${step.method ?? 'any method'} ${step.match}`;
      await poll(async () => count(), (value) => value >= step.count, (value) => `Expected ${step.count} request(s) to ${label}, saw ${value}`, timeout);
      // Hold briefly so duplicate submissions that arrive just after the first one are still caught.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const settled = count();
      if (settled !== step.count) throw new Error(`Expected exactly ${step.count} request(s) to ${label}, saw ${settled}`);
      return;
    }
  }

  const locator = resolveTarget(page, step.target);
  switch (step.action) {
    case 'click': await locator.click(); break;
    case 'fill': await locator.fill(step.value); break;
    case 'press': await locator.press(step.key); break;
    case 'selectOption': await locator.selectOption(step.value); break;
    case 'waitFor':
    case 'expectVisible': await locator.waitFor({ state: 'visible' }); break;
    case 'expectHidden': await locator.waitFor({ state: 'hidden' }); break;
    case 'expectText':
      await poll(
        async () => locator.first().innerText({ timeout: 500 }).catch(() => undefined),
        (text) => text !== undefined && (step.exact ? text.trim() === step.text : text.includes(step.text)),
        (text) => `Expected text ${step.exact ? '' : 'containing '}"${step.text}", got ${text === undefined ? 'no matching element' : JSON.stringify(text.trim().slice(0, 120))}`,
        timeout,
      );
      break;
    case 'expectValue':
      await poll(async () => locator.first().inputValue({ timeout: 500 }).catch(() => undefined), (value) => value === step.value,
        (value) => `Expected value ${JSON.stringify(step.value)}, got ${value === undefined ? 'no matching input' : JSON.stringify(value)}`, timeout);
      break;
    case 'expectEnabled':
    case 'expectDisabled': {
      const wantDisabled = step.action === 'expectDisabled';
      await poll(async () => locator.first().isDisabled({ timeout: 500 }).catch(() => undefined), (disabled) => disabled === wantDisabled,
        (disabled) => `Expected control to be ${wantDisabled ? 'disabled' : 'enabled'}, it is ${disabled === undefined ? 'missing' : disabled ? 'disabled' : 'enabled'}`, timeout);
      break;
    }
    case 'expectFocused':
      await poll(
        async () => locator.first().evaluate((element) => {
          const active = document.activeElement;
          const label = active ? `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}${active.getAttribute('aria-label') ? ` "${active.getAttribute('aria-label')}"` : ''}` : 'nothing';
          return { focused: element === active || element.contains(active), active: label };
        }, undefined, { timeout: 500 }).catch(() => undefined),
        (state) => state?.focused === true,
        (state) => `Expected focus on the target element, focus is on ${state ? state.active : 'a missing target'}`,
        timeout,
      );
      break;
    case 'expectCount':
      await poll(async () => locator.count(), (count) => count === step.count, (count) => `Expected ${step.count} matching element(s), found ${count}`, timeout);
      break;
  }
}
