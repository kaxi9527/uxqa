import type { Browser, BrowserContext, Page, Request } from 'playwright';
import { executeStep } from './steps.js';
import { evaluateRelation, observeValue, type ObservedValue, type LogicVerdict } from './journey-logic.js';
import type { BusinessJourney, CheckResult, JourneyList } from './types.js';

type Row = Record<string, string>;
type PhaseResult = Pick<CheckResult, 'status' | 'route' | 'detail'> & {
  actor: string; phase: string;
  observations?: Record<string, ObservedValue>;
  relations?: LogicVerdict[];
  observed?: { rows: Row[]; saveAs?: string; equals?: string; where?: Record<string, string> };
};
class BusinessMismatch extends Error {}
class MissingWitness extends Error {}

async function readList(page: Page, list: JourneyList): Promise<Row[]> {
  const container = page.locator(list.container);
  // A loaded, empty list may have no rendered height. Its total distinguishes it from a missing list.
  await container.waitFor({ state: 'attached' });
  return container.evaluate((element, spec) => {
    const total = element.getAttribute(spec.totalAttribute);
    const rows = [...element.querySelectorAll(spec.rows)];
    if (total === null || !/^\d+$/.test(total) || Number(total) !== rows.length) throw new Error('Full list unavailable: the declared total and rendered rows must agree (load all pages first)');
    const fields = Object.keys(spec.fields).sort();
    return rows.map(row => Object.fromEntries(fields.map(key => {
      const value = row.getAttribute(spec.fields[key]!);
      if (!value?.trim()) throw new Error('Missing stable row field: ' + key);
      return [key, value];
    })));
  }, list);
}

function rowDifferences(expected: Row[], actual: Row[]): Array<[string,number]> {
  const delta = new Map<string, number>();
  for (const row of expected) {
    const key = JSON.stringify(row);
    delta.set(key, (delta.get(key) ?? 0) + 1);
  }
  for (const row of actual) {
    const key = JSON.stringify(row);
    delta.set(key, (delta.get(key) ?? 0) - 1);
  }
  return [...delta].filter(([, count]) => count !== 0);
}

export async function runBusinessJourney(browser: Browser, baseUrl: string, plan: BusinessJourney, options: {
  actorStates?: Record<string, string>; restrictToPreview?: boolean;
} = {}): Promise<PhaseResult[]> {
  const sessions = new Map<string, { context: BrowserContext; page: Page }>();
  const snapshots = new Map<string, Row[]>();
  const facts = new Map<string, ObservedValue>();
  const results: PhaseResult[] = [];
  let stopped = false;
  let relationFailed = false;
  let missingWitness = '';
  try {
    for (const phase of plan.phases) {
      const where = { phase: phase.name, actor: phase.actor, route: phase.route };
      if (missingWitness) {
        results.push({...where,status:'not-verified',detail:'未执行，缺少前置证据 / Missing prerequisite: '+missingWitness});
        continue;
      }
      if (relationFailed && phase.steps.some(step => !step.action.startsWith('expect') && step.action !== 'waitFor' && step.action !== 'waitForHidden')) stopped = true;
      if (stopped) {
        results.push({ ...where, status: 'blocked', detail: 'An earlier operation or prerequisite did not complete' });
        continue;
      }
      let assertion = false;
      let observed: PhaseResult['observed'];
      const observations = new Map<string, ObservedValue>();
      const relations: LogicVerdict[] = [];
      let status: PhaseResult['status'] = 'pass';
      try {
        let session = sessions.get(phase.actor);
        if (!session) {
          const state = options.actorStates && Object.hasOwn(options.actorStates, phase.actor) ? options.actorStates[phase.actor] : undefined;
          const context = await browser.newContext({ storageState: state, serviceWorkers: 'block' });
          context.setDefaultTimeout(8000);
          try {
            if (options.restrictToPreview) {
              const origin = new URL(baseUrl).origin;
              await context.routeWebSocket('**/*', socket => socket.close());
              await context.route('**/*', async route => {
                if (new URL(route.request().url()).origin !== origin) return route.abort();
                // Inspect the first response before the browser can follow a redirect outside the preview.
                const response = await route.fetch({ maxRedirects: 0, timeout: 10000 }).catch(() => undefined);
                if (!response) return route.abort();
                try {
                  const location = response.headers().location;
                  if (location && new URL(location, response.url()).origin !== origin) return await route.abort();
                  await route.fulfill({ response });
                } finally { await response.dispose(); }
              });
            }
            session = { context, page: await context.newPage() };
            sessions.set(phase.actor, session);
          } catch (error) { await context.close(); throw error; }
        }
        const { page } = session;
        const requests: Array<{ method: string; url: string }> = [];
        const observe = (request: Request) => requests.push({ method: request.method(), url: request.url() });
        page.on('request', observe);
        let detail = 'Completed ' + phase.steps.length + ' step(s)';
        try {
          const target = new URL(phase.route, baseUrl);
          if (phase.continueOnPage) {
            if (page.url() !== target.href) throw new MissingWitness('原操作页面已变化 / Original page is no longer active');
          } else {
            const response = await page.goto(target.href, { waitUntil: 'load' });
            if (!response?.ok() || new URL(page.url()).origin !== target.origin) throw new Error('Test page unavailable for actor: ' + phase.actor);
            if (phase.exactRoute && page.url()!==target.href) throw new MissingWitness('未到达绑定的页面 / Bound route was not reached: '+phase.route);
          }
          for (const step of phase.steps) {
            assertion = step.action.startsWith('expect');
            await executeStep(page, step, { requests });
            if (assertion) detail += '\n✓ ' + JSON.stringify(step);
            assertion = false;
          }
          for (const observation of phase.observe ?? []) {
            const value = await observeValue(page, observation);
            observations.set(observation.id, value);
            facts.set(observation.id, value);
            if ('unavailable' in value) {
              status = 'not-verified';
              detail += `\n${observation.id}: ${value.unavailable}`;
            }
          }
          for (const rule of phase.requires ?? []) {
            const verdict=evaluateRelation(rule,facts);
            if (verdict.status!=='pass') throw new MissingWitness(rule.name+' · '+verdict.detail);
            detail+='\n✓ '+rule.name+' · '+verdict.detail;
          }
          for (const rule of phase.assert ?? []) {
            const verdict = evaluateRelation(rule, facts);
            relations.push(verdict);
            detail += `\n${rule.name} · ${verdict.status} · ${verdict.detail}`;
            if (verdict.status === 'fail') relationFailed = true;
            if (status !== 'fail' && verdict.status !== 'pass') status = verdict.status;
          }
          if (phase.list) {
            const list = phase.list;
            const rows = await readList(page, list);
            observed = { rows, saveAs: list.saveAs, equals: list.equals, where: list.where };
            if (list.partitionWitness) {
              const {field,baselines}=list.partitionWitness;
              if (rows.some(row=>!Object.hasOwn(baselines,row[field]))) throw new MissingWitness('预览包含未绑定的接收方 / Unbound recipient in preview');
              const changed=Object.entries(baselines).some(([recipient,ref])=>{
                const previous=snapshots.get(ref);
                if (!previous) throw new MissingWitness('Missing recipient baseline: '+ref);
                return rowDifferences(previous,rows.filter(row=>row[field]===recipient)).length>0;
              });
              if (!changed || !rows.length) throw new MissingWitness('预览与原分配缺少可辨别的变化 / No distinguishable assignment change');
            }
            if (list.saveAs) snapshots.set(list.saveAs, rows);
            if (list.equals) {
              const baseline = snapshots.get(list.equals);
              if (!baseline) throw new Error('Referenced snapshot was not captured');
              const expected = baseline.filter(row => Object.entries(list.where ?? {}).every(([key, value]) => row[key] === value));
              const differences=rowDifferences(expected,rows);
              if (differences.length) throw new BusinessMismatch(differences.slice(0,20).map(([key,count])=>(count>0?'missing':'extra')+' ×'+Math.abs(count)+' '+key).join('\n')+(differences.length>20?'\n… '+(differences.length-20)+' more differing keys':''));
            }
            detail += `; ${rows.length} row(s) ${list.equals ? 'matched ' + list.equals : 'captured as ' + list.saveAs}`;
          }
        } finally { page.off('request', observe); }
        results.push({ ...where, status, detail, observed, ...(observations.size ? { observations: Object.fromEntries(observations) } : {}), ...(relations.length ? { relations } : {}) });
      } catch (error) {
        const mismatch = error instanceof BusinessMismatch;
        if (error instanceof MissingWitness) missingWitness=error.message;
        results.push({ ...where, status: mismatch || assertion || status === 'fail' ? 'fail' : missingWitness ? 'not-verified' : 'blocked', detail: error instanceof Error ? error.message : String(error), observed, ...(observations.size ? { observations: Object.fromEntries(observations) } : {}), ...(relations.length ? { relations } : {}) });
        // Read-only list differences do not prevent observing the other recipients.
        if (mismatch) relationFailed = true;
        else stopped = true;
      }
    }
    for (const gap of plan.gaps) results.push({ phase: plan.name, actor: '—', route: '(journey)', status: 'not-verified', detail: gap });
    return results;
  } finally { await Promise.all([...sessions.values()].map(({ context }) => context.close())); }
}
