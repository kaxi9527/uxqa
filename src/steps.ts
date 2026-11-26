import type { Page } from 'playwright';
import { matchesUrl } from './glob.js';
import { resolveTarget } from './locator.js';
import type { Step, Target } from './types.js';

export interface StepContext {
  /** Requests observed since the flow started (method upper-case, absolute URL). */
  requests: Array<{ method: string; url: string }>;
  timeoutMs?: number;
  onDiagnostic?: (message:string)=>void;
  recovery?: { injected: boolean; recovered: boolean };
}

const LIVE_REGION = '[role="status"],[role="alert"],[role="log"],[aria-live="polite"],[aria-live="assertive"],output';

async function bindingHint(page:Page,target:Extract<Target,{role:string}>,name:string){
  const declared=await page.locator('[role]').evaluateAll(nodes=>Array.from(new Set(nodes.flatMap(n=>(n.getAttribute('role')??'').split(/\s+/).filter(Boolean)))));
  const roles=new Set(['button','link','tab','menuitem','checkbox','radio','textbox','searchbox','combobox','listbox','option','heading','img','slider','spinbutton','progressbar','navigation','region','form','table','group',...declared]);
  roles.delete(target.role);
  const observations=await Promise.all([...roles].map(async role=>{
    // ARIA authors can supply fallback or unsupported roles. Only report a name the browser locator confirms.
    const count=await page.getByRole(role as typeof target.role,{name,exact:true}).count().catch(()=>0);
    return count?count+' '+role:null;
  }));
  const texts=await page.getByText(name,{exact:true}).filter({visible:true}).count();
  if(texts)observations.push(texts+' visible text');
  if(name.length>=3){
    const prefix=name.slice(0,Math.min(8,name.length-1)).replace(/[.*+?^$\x7b\x7d()|[\]\\]/g,'\\$&');
    const near=page.getByRole(target.role,{name:new RegExp('^'+prefix,'i')});
    const snapshot=await near.count()?await near.first().ariaSnapshot({depth:1,timeout:150}).catch(()=>''):'';
    if(snapshot)observations.push('similar: '+snapshot.split('\n')[0].slice(0,120));
  }
  const alternatives=observations.filter(Boolean).join(', ');
  return alternatives?'Expected '+target.role+' '+JSON.stringify(name)+' (0 visible matches); observed '+alternatives+'. Verify the binding.':'';
}

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
    case 'beforeLanguageSwitch':
      if ((await page.locator('html').getAttribute('lang'))?.toLowerCase() === step.lang.toLowerCase()) throw new Error('Page already uses the target language; choose the initial language in setup.');
      return;
    case 'firstTab':
      await poll(() => page.locator('html').getAttribute('lang'), lang => lang?.toLowerCase() === step.lang.toLowerCase(), lang => 'Expected document language ' + step.lang + ', got ' + lang, timeout);
      // Re-enter from the beginning of this document without reloading or losing a non-persisted locale.
      await page.evaluate(() => {
        const start = document.createElement('span');
        start.tabIndex = -1;
        document.body.prepend(start);
        start.focus();
        start.remove();
      });
      await page.keyboard.press('Tab');
      return;
    case 'expectRecoveryResponse':
      await poll(async () => context?.recovery, state => !!state?.recovered,
        state => state?.injected ? 'No successful retry response for ' + step.match : 'Configured GET fault did not trigger: ' + step.match, timeout);
      return;
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

  const target=step.target;
  const locator = resolveTarget(page, target);
  // Give an early binding hint while preserving the full wait for slowly appearing controls.
  if('role' in target && target.name && ['expectVisible','waitFor','click','fill','press','selectOption'].includes(step.action)){
    const firstWait=Math.min(650,timeout);
    try{await locator.first().waitFor({state:'visible',timeout:firstWait});}
    catch(error){
      const hint=await bindingHint(page,target,target.name).catch(()=>'');
      if(hint)context?.onDiagnostic?.(hint);
      try{
        if(timeout<=firstWait)throw error;
        await locator.first().waitFor({state:'visible',timeout:timeout-firstWait});
      }catch(finalError){
        const finalHint=await bindingHint(page,target,target.name).catch(()=>'');
        throw Error((finalError instanceof Error?finalError.message:String(finalError))+(finalHint?' · '+finalHint:''));
      }
    }
  }
  switch (step.action) {
    case 'click': await locator.click(); break;
    case 'fill': await locator.fill(step.value); break;
    case 'press': await locator.press(step.key); break;
    case 'selectOption': await locator.selectOption(step.value); break;
    case 'waitFor':
    case 'expectVisible': await locator.waitFor({ state: 'visible' }); break;
    case 'waitForHidden':
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
