import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readAiSettings, type AiSettings } from '../ai/model.js';
import { applyReview, reviewTasks, reviewWithModel } from '../ai/review.js';
import { capturePages, type CaptureReport } from '../capture/pages.js';
import { routesFromSource } from '../capture/routes.js';
import { coveredSelectors, runCheck } from '../check/run.js';
import { readInventory } from '../inventory/read.js';
import { ruleCatalog } from '../rules/catalog.js';
import { buildRuleSet, readRuleFile } from '../rules/load.js';
import { auditVisual } from '../visual/audit.js';
import { getRound, listRounds, newRoundId, saveRound, shotsDir, updateRound, type ProjectEntry, type Round } from './store.js';
import { compareViews } from '../visual/compare.js';
import { createHash } from 'node:crypto';
import { browserReady, MISSING_SENTENCE } from '../browser/install.js';

/** One full check of a project: source, page screenshots, page checks, and (when configured) the screenshot review. */
export interface RoundProgress { phase: 'source' | 'pages' | 'ai' | 'saving'; message: string; done?: number; total?: number }

export async function runRound(entry: ProjectEntry, options: { signal?: AbortSignal; progress?: (step: RoundProgress) => void; skipPages?: boolean } = {}): Promise<Round> {
  const progress = options.progress ?? (() => undefined);
  const aborted = () => !!options.signal?.aborted;
  progress({ phase: 'source', message: '正在检查源码' });
  const baseline = join(entry.root, '.uxqa/baseline.json');
  const result = await runCheck({ source: entry.root, baselinePath: await stat(baseline).then(() => baseline, () => undefined) });
  const roundId = newRoundId();
  let capture: CaptureReport | undefined;
  let partial: string | undefined;
  // No browser yet (it is downloaded only after the person agrees): the source check still counts as a full round.
  const noBrowser = !!entry.pages?.baseUrl && (options.skipPages || !(await browserReady('shell').catch(() => true)));
  if (noBrowser) partial = MISSING_SENTENCE;
  else if (entry.pages?.baseUrl && !aborted()) {
    progress({ phase: 'pages', message: '正在打开页面截图' });
    try {
      // "Find more pages" also opens the plain paths declared in the product's router.
      const routes = entry.pages.discover ? [...new Set([...entry.pages.routes, ...await routesFromSource(result.productRoot)])].slice(0, 24) : entry.pages.routes;
      capture = await capturePages(result.violations, {
        baseUrl: entry.pages.baseUrl, routes, discover: entry.pages.discover,
        ...(entry.pages.storageState ? { storageState: entry.pages.storageState } : {}),
      }, shotsDir(entry.id, roundId), {
        ...(options.signal ? { signal: options.signal } : {}),
        progress: (step) => progress({ phase: 'pages', message: step.message, done: step.done, total: step.total }),
      });
      if (capture.cancelled) partial = '截图被取消，只完成了部分页面。';
      else if (capture.pages.length && capture.pages.every((page) => page.status === 'failed')) partial = `页面都没有打开成功（${capture.pages[0].error ?? '原因不明'}），这一轮没有截图。请确认预览地址可以访问。`;
      // Page-level visual checks: every page that opened, from wide to narrow.
      const opened = capture.pages.filter((page) => page.status === 'ok').map((page) => page.route);
      if (opened.length && !aborted()) {
        progress({ phase: 'pages', message: '正在把页面从宽到窄检查一遍' });
        const ruleFile = await readRuleFile(result.productRoot);
        const ruleSet = buildRuleSet(ruleFile.raw, ruleFile.path);
        const inventory = await readInventory(result.productRoot, { ...(ruleSet.libraryRoot ? { root: ruleSet.libraryRoot } : {}), libraries: ruleSet.libraries });
        const visual = await auditVisual({ baseUrl: entry.pages.baseUrl, routes: opened, productRoot: result.productRoot, ...(entry.pages.storageState ? { storageState: entry.pages.storageState } : {}) }, shotsDir(entry.id, roundId), {
          ...(options.signal ? { signal: options.signal } : {}),
          progress: (message) => progress({ phase: 'pages', message }),
          disabled: new Set(ruleSet.visual.filter((rule) => rule.level === 'off').map((rule) => rule.id)),
          levels: new Map(ruleSet.visual.filter((rule) => rule.level !== 'off').map((rule) => [rule.id, rule.level as 'must' | 'default' | 'reference'])),
          firstNumber: result.violations.filter((violation) => violation.status === 'new').length + 1,
          reuse: { selectors: coveredSelectors(inventory), library: inventory.components.map((component) => component.name), product: result.components ?? [] },
        });
        capture.reuse = visual.reuse;
        result.violations.push(...visual.violations);
        capture.captures = { ...capture.captures, ...visual.captures };
        capture.views = visual.views;
        // Before/after: the same pages in the previous round with screenshots.
        let previous: Round | undefined;
        for (const summary of (await listRounds(entry.id)).slice(0, 5)) {
          const round = await getRound(entry.id, summary.id);
          if (round?.capture?.views?.length) { previous = round; break; }
        }
        if (previous?.capture?.views?.length && !aborted()) {
          progress({ phase: 'pages', message: '正在和上一轮的页面截图对比' });
          capture.changes = await compareViews({ round: previous.id, views: previous.capture.views }, visual.views, (view) => join(shotsDir(entry.id, roundId), `change-${createHash('sha256').update(`${view.route}|${view.width}`).digest('hex').slice(0, 10)}.png`)).catch(() => []);
        }
        result.summary.newMust += visual.violations.filter((violation) => violation.level === 'must').length;
        result.summary.newDefault += visual.violations.filter((violation) => violation.level === 'default').length;
        result.summary.newReference += visual.violations.filter((violation) => violation.level === 'reference').length;
      }
    } catch (error) {
      partial = `截图没有完成：${error instanceof Error ? error.message.split('\n')[0] : String(error)}。源码检查的结果不受影响。`;
    }
  } else if (aborted()) partial = '检测被取消，只完成了源码检查。';
  progress({ phase: 'saving', message: '正在保存' });
  const round = await saveRound(entry.id, result, { roundId, ...(capture ? { capture } : {}), ...(partial ? { partial } : {}) });
  const ai = await readAiSettings();
  if (ai.mode === 'api' && capture && !aborted()) await reviewRound(entry, round, ai, options);
  return round;
}

/** Plain sentences for the review prompts: what each rule asks for, plus the project's own one-line rules. */
export async function reviewContext(entry: ProjectEntry) {
  const ruleFile = await readRuleFile(entry.root);
  const ruleSet = buildRuleSet(ruleFile.raw, ruleFile.path);
  const catalog = ruleCatalog(ruleSet);
  const sentence = new Map(catalog.map((item) => [item.id, item.rule]));
  const pageRules = [
    ...catalog.filter((item) => item.kind === 'page' && item.level !== 'off').map((item) => item.rule),
    ...ruleSet.guidance.filter((item) => item.level !== 'off').map((item) => item.text),
  ];
  return { ruleText: (id: string) => sentence.get(id), pageRules };
}

/** Asks the configured vision model to review this round's screenshots and stores what it says. */
export async function reviewRound(entry: ProjectEntry, round: Round, settings: AiSettings, options: { signal?: AbortSignal; progress?: (step: RoundProgress) => void } = {}) {
  const { ruleText, pageRules } = await reviewContext(entry);
  const tasks = reviewTasks(round, ruleText, pageRules);
  if (!tasks.length) return { verified: 0, found: 0, calls: 0, errors: [] as string[] };
  const outcome = await reviewWithModel(settings, tasks, {
    ...(options.signal ? { signal: options.signal } : {}),
    progress: (done, total) => options.progress?.({ phase: 'ai', message: `AI 正在看截图复核（${done}/${total}）`, done, total }),
  });
  const applied = applyReview(round, outcome.answers, { by: settings.model, calls: outcome.calls, errors: outcome.errors, reviewedViews: outcome.reviewedViews });
  await updateRound(entry.id, round);
  return { ...applied, calls: outcome.calls, errors: outcome.errors };
}
