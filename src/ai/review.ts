import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Capture } from '../capture/pages.js';
import type { Violation } from '../check/run.js';
import type { Round } from '../ui/store.js';
import { askVision, parseJson, pngSize, type AiSettings } from './model.js';

/**
 * A second pair of eyes on the screenshots. Two jobs:
 * - verify: for every problem that has a boxed screenshot, does the image really show it?
 * - discover: look at whole page screens for problems the rules describe but the programs did not catch.
 * Either uxqa asks a configured vision model (several independent looks; only agreement counts), or the user's own
 * AI agent does the looking through MCP and submits the answers. Model opinions are stored next to the
 * deterministic results and shown as such; they never delete or change a finding.
 */
export type Verdict = 'real' | 'not-real' | 'unsure';
export interface AiNote { verdict: Verdict; reason: string; by: string; looks: number; at: string }
export interface AiRoundInfo { by: string; at: string; calls: number; reviewedViews: string[]; errors: string[] }

export interface VerifyTask { kind: 'verify'; id: string; name: string; what: string; rule: string; image: string }
export interface DiscoverTask { kind: 'discover'; id: string; route: string; width: number; image: string; rules: string[]; known: string[] }
export type ReviewTask = VerifyTask | DiscoverTask;

export interface Finding { view: string; title: string; detail: string; fix?: string; rule?: string; domain?: Violation['domain']; box?: [number, number, number, number] }
export interface ReviewAnswers { verdicts: Array<{ id: string; verdict: Verdict; reason: string; looks?: number }>; findings: Finding[] }

const LEVEL_ORDER = { must: 0, default: 1, reference: 2 } as const;

/** What still needs a look in this round. `ruleText` turns a rule id into the plain sentence shown to people. */
export function reviewTasks(round: Round, ruleText: (id: string) => string | undefined, pageRules: string[]): ReviewTask[] {
  const captures = round.capture?.captures ?? {};
  const fresh = round.result.violations.filter((violation) => violation.status === 'new');
  const verify: VerifyTask[] = fresh
    .filter((violation) => !violation.ai && violation.origin !== 'ai' && captures[violation.fingerprint]?.shots.length)
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    .map((violation) => ({ kind: 'verify', id: violation.fingerprint, name: violation.name, what: violation.what, rule: ruleText(violation.rule) ?? violation.title, image: captures[violation.fingerprint].shots[0].crop }));
  const reviewed = new Set(round.ai?.reviewedViews ?? []);
  const discover: DiscoverTask[] = (round.capture?.views ?? [])
    .map((view) => ({ view, id: `${view.route}|${view.width}` }))
    .filter(({ id }) => !reviewed.has(id))
    .map(({ view, id }) => ({
      kind: 'discover', id, route: view.route, width: view.width, image: view.image, rules: pageRules,
      known: fresh.filter((violation) => violation.detail.includes(`页面 ${view.route}；`) || violation.file === `页面 ${view.route}`).map((violation) => violation.name).slice(0, 30),
    }));
  return [...verify, ...discover];
}

export function verifyPrompt(task: VerifyTask): string {
  return [
    '你在帮新手检查网页界面。图里红框圈出的是自动检查认为有问题的地方。',
    `问题：${task.name}`,
    `说明：${task.what}`,
    `对应的规则：${task.rule}`,
    '只根据这张图判断：这个问题在红框的位置是否真的存在？看不清、图里看不出来，就答 unsure，不要猜。',
    '只回答一个 JSON，不要别的文字：{"verdict":"real 或 not-real 或 unsure","reason":"一句中文理由"}',
  ].join('\n');
}

export function discoverPrompt(task: DiscoverTask, size: { width: number; height: number }): string {
  return [
    `这是网页 ${task.route} 在 ${task.width}px 宽的窗口里的截图，图片是 ${size.width}×${size.height} 像素。`,
    '请按下面的界面规则检查，只报告你在图里能明确看到的问题；拿不准的不要报，宁可少报也不要报错。',
    '分类：ui 是视觉呈现；ux 是任务与交互线索；experience 是响应与反馈。单张截图不能证明操作流程、动画时序、卡顿或手势问题；这些需要实际交互验证，不要据此猜测。',
    '项目规则、品牌和组件规范优先于通用指南。不要把个人风格偏好、字体或配色推荐当作缺陷；明确关闭的检查不得通过通用指南重新报告。',
    ...task.rules.map((rule) => `- ${rule}`),
    task.known.length ? `这些问题已经发现了，不用再报：${task.known.join('；')}` : '',
    '只回答一个 JSON，不要别的文字：{"problems":[{"title":"具体的问题名，例如「提交」按钮被遮住了一半","detail":"在哪里、哪里不对","fix":"怎么改，一句话","rule":"对应上面哪条规则","domain":"ui 或 ux 或 experience","box":[x,y,宽,高]}]}',
    'box 用这张图的像素坐标框出问题所在的位置。最多报 6 个；没有问题就回答 {"problems":[]}。',
  ].filter(Boolean).join('\n');
}

export function confirmPrompt(finding: Finding, task: DiscoverTask): string {
  return [
    `这是网页 ${task.route} 在 ${task.width}px 宽时的截图。有人说图里有这个界面问题：`,
    `「${finding.title}」：${finding.detail}`,
    finding.box ? `大致位置：x=${finding.box[0]}, y=${finding.box[1]}, 宽 ${finding.box[2]}, 高 ${finding.box[3]}（图片像素坐标）。` : '',
    '请你自己仔细看图，判断这个问题是否真的存在。看不出来就答 unsure。',
    '只回答一个 JSON，不要别的文字：{"verdict":"real 或 not-real 或 unsure","reason":"一句中文理由"}',
  ].filter(Boolean).join('\n');
}

/** Several independent looks; a verdict stands only when all of them agree, otherwise "unsure". */
function agree(answers: Array<{ verdict?: string; reason?: string }>): { verdict: Verdict; reason: string } {
  const verdicts = answers.map((answer) => (answer.verdict === 'real' || answer.verdict === 'not-real' ? answer.verdict : 'unsure') as Verdict);
  const verdict: Verdict = verdicts.length && verdicts.every((value) => value === verdicts[0]) ? verdicts[0] : 'unsure';
  const reason = answers.find((answer, index) => verdicts[index] === verdict && answer.reason)?.reason ?? (verdict === 'unsure' && verdicts.length > 1 ? `几次看图的结论不一致（${verdicts.join('、')}）` : '');
  return { verdict, reason };
}

/** Runs the review with the configured model. Stops at the call budget; failures are recorded, never fatal. */
export async function reviewWithModel(settings: AiSettings, tasks: ReviewTask[], options: { signal?: AbortSignal; progress?: (done: number, total: number) => void } = {}): Promise<{ answers: ReviewAnswers; calls: number; errors: string[]; reviewedViews: string[] }> {
  const answers: ReviewAnswers = { verdicts: [], findings: [] };
  const errors: string[] = [];
  const reviewedViews: string[] = [];
  const passes = Math.min(3, Math.max(1, Math.round(settings.passes || 1)));
  let calls = 0;
  const budgetLeft = () => calls < settings.maxCalls;
  const work = tasks.filter((task) => (task.kind === 'verify' ? settings.verify : settings.discover));
  let done = 0;
  for (const task of work) {
    if (options.signal?.aborted || !budgetLeft()) break;
    options.progress?.(done++, work.length);
    try {
      const image = await readFile(task.image);
      if (task.kind === 'verify') {
        const looks: Array<{ verdict?: string; reason?: string }> = [];
        for (let look = 0; look < passes && budgetLeft(); look++) {
          calls++;
          looks.push(parseJson<{ verdict?: string; reason?: string }>(await askVision(settings, verifyPrompt(task), [image], options.signal)) ?? {});
        }
        answers.verdicts.push({ id: task.id, ...agree(looks), looks: looks.length });
        continue;
      }
      calls++;
      const size = pngSize(image);
      const found = parseJson<{ problems?: Finding[] }>(await askVision(settings, discoverPrompt(task, size), [image], options.signal))?.problems ?? [];
      reviewedViews.push(task.id);
      for (const finding of found.slice(0, 6)) {
        if (!finding || typeof finding.title !== 'string' || !finding.title.trim()) continue;
        // Each claim is checked again from scratch; only a unanimous "real" is kept.
        const looks: Array<{ verdict?: string; reason?: string }> = [];
        for (let look = 0; look < passes && budgetLeft(); look++) {
          calls++;
          looks.push(parseJson<{ verdict?: string; reason?: string }>(await askVision(settings, confirmPrompt(finding, task), [image], options.signal)) ?? {});
        }
        if (looks.length === passes && agree(looks).verdict === 'real') answers.findings.push({ ...finding, view: task.id });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      if (errors.length >= 3) break; // a wrong key or address fails every call; stop early and say so
    }
  }
  options.progress?.(done, work.length);
  return { answers, calls, errors, reviewedViews };
}

/** Writes review answers into the round: notes on existing problems, and confirmed new problems with their screenshot. */
export function applyReview(round: Round, answers: ReviewAnswers, info: { by: string; calls?: number; errors?: string[]; reviewedViews?: string[] }): { verified: number; found: number } {
  const at = new Date().toISOString();
  const byFingerprint = new Map(round.result.violations.map((violation) => [violation.fingerprint, violation]));
  let verified = 0;
  for (const entry of answers.verdicts) {
    const violation = byFingerprint.get(entry.id);
    if (!violation || !['real', 'not-real', 'unsure'].includes(entry.verdict)) continue;
    violation.ai = { verdict: entry.verdict, reason: String(entry.reason ?? '').slice(0, 300), by: info.by, looks: entry.looks ?? 1, at };
    verified++;
  }
  const views = new Map((round.capture?.views ?? []).map((view) => [`${view.route}|${view.width}`, view]));
  const captures: Record<string, Capture> = round.capture?.captures ?? {};
  let number = round.result.violations.filter((violation) => violation.status === 'new').length;
  let found = 0;
  for (const finding of answers.findings) {
    const view = views.get(finding.view);
    if (!view || !finding.title?.trim()) continue;
    const title = finding.title.trim().slice(0, 80);
    const fingerprint = `${createHash('sha256').update(`ai/look\n${view.route}\n${title}`).digest('hex').slice(0, 16)}#1`;
    if (byFingerprint.has(fingerprint)) continue;
    let mark: Capture['mark'];
    if (Array.isArray(finding.box) && finding.box.length === 4 && finding.box.every((value) => Number.isFinite(Number(value)))) {
      // Image pixel coordinates; the console scales them onto the shown screenshot.
      const [x, y, width, height] = finding.box.map(Number);
      mark = { x, y, width, height };
    }
    const violation: Violation = {
      name: title, title: 'AI 看图发现',
      what: String(finding.detail ?? '').slice(0, 400) || title,
      consequence: '这是看截图时发现的，程序的规则没有覆盖到这里。',
      fix: String(finding.fix ?? '').slice(0, 300) || '按说明调整这个位置，改完再检测一次。',
      rule: 'ai/look', level: 'default', origin: 'ai',
      domain: finding.domain === 'ux' || finding.domain === 'experience' ? finding.domain : 'ui',
      file: `页面 ${view.route}`, line: 0, column: 0, snippet: '',
      detail: `AI 看图（${info.by}）：${finding.rule ? `对应规则「${finding.rule}」；` : ''}页面 ${view.route}；${view.width} 宽`,
      status: 'new', fingerprint,
    };
    round.result.violations.push(violation);
    byFingerprint.set(fingerprint, violation);
    captures[fingerprint] = { number: ++number, status: 'found', shots: [{ route: view.route, viewport: `${view.width}`, crop: view.image, full: view.image, matches: 1 }], matches: 1, note: 'AI 在整屏截图上标出的大致位置。', ...(mark ? { mark } : {}) };
    found++;
  }
  if (round.capture) round.capture.captures = captures;
  round.result.summary.newDefault += found;
  round.newDefault += found;
  const previous = round.ai;
  round.ai = {
    by: info.by, at,
    calls: (previous?.calls ?? 0) + (info.calls ?? 0),
    reviewedViews: [...new Set([...(previous?.reviewedViews ?? []), ...(info.reviewedViews ?? [])])],
    errors: info.errors ?? [],
  };
  return { verified, found };
}
