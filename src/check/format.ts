import type { CheckResult, Violation } from './run.js';
import { issueGuidance } from '../guidance/issues.js';

const LEVEL_WORD: Record<Violation['level'], string> = { must: '需要改', default: '建议改', reference: '可以看看' };

function card(violation: Violation, index: number): string {
  return [
    `${index}. ${violation.name}（${violation.title}，${LEVEL_WORD[violation.level]}）· ${violation.file}:${violation.line}`,
    `   ${violation.what}`,
    `   会怎样：${violation.consequence}`,
    `   怎么改：${violation.fix}`,
  ].join('\n');
}

/** People-facing summary in plain language. */
export function formatText(result: CheckResult, options: { limit?: number } = {}): string {
  const limit = options.limit ?? 20;
  const fresh = result.violations.filter((violation) => violation.status === 'new');
  const lines: string[] = [];
  const where = result.scope === 'files' ? `检查了 ${result.filesScanned} 个改动的文件` : `检查了整个项目的 ${result.filesScanned} 个文件`;
  const library = result.library.path ? `组件库：${result.library.path}（${result.library.components} 个组件）` : '没有找到组件库：只能检查写死的颜色和尺寸';
  if (!fresh.length) lines.push(`没有发现新问题。${where}。`);
  else {
    const counts = [result.summary.newMust && `${result.summary.newMust} 个需要改`, result.summary.newDefault && `${result.summary.newDefault} 个建议改`, result.summary.newReference && `${result.summary.newReference} 个可以看看`].filter(Boolean).join('，');
    lines.push(`发现 ${fresh.length} 个新问题（${counts}）。${where}。`);
  }
  lines.push(library);
  if (result.baseline && (result.summary.baseline || result.baseline.fixed)) {
    lines.push(`老问题：${result.summary.baseline} 个已记录在基线里，这次不算${result.baseline.fixed ? `；有 ${result.baseline.fixed} 个老问题本轮未再检出，需结合覆盖范围确认` : ''}。`);
  }
  if (fresh.length) {
    lines.push('');
    fresh.slice(0, limit).forEach((violation, index) => { lines.push(card(violation, index + 1)); lines.push(''); });
    if (fresh.length > limit) lines.push(`还有 ${fresh.length - limit} 个没有列出来，加上 --all 查看全部。`);
  }
  if (result.summary.ignored) lines.push(`已按注释忽略 ${result.summary.ignored} 个（每个都写了理由，详见 --format json）。`);
  if (result.ignoreWithoutReason.length) lines.push(`有 ${result.ignoreWithoutReason.length} 个忽略注释没写理由，所以没有生效：${result.ignoreWithoutReason.slice(0, 5).map((entry) => `${entry.file}:${entry.line}`).join('、')}。写法：// uxqa-ignore 规则名 -- 理由`);
  if (result.rules.disabled.length) lines.push(`已关闭的默认规则：${result.rules.disabled.map((entry) => `${entry.id}（理由：${entry.reason}）`).join('；')}。`);
  if (result.rules.guidance.length) {
    lines.push('这些规则是一句话描述，没法自动检查，请你和 AI 自己留意：');
    for (const entry of result.rules.guidance) lines.push(`  - ${entry.text}`);
  }
  if (result.skipped.length) lines.push(`没检查的文件 ${result.skipped.length} 个：${result.skipped.slice(0, 5).map((entry) => `${entry.file}（${entry.reason}）`).join('；')}。`);
  for (const issue of result.library.issues) lines.push(`注意：${issue}`);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

const PRIORITY: Record<Violation['level'], string> = { must: '【需要改】', default: '【建议改】', reference: '【可以看看】' };

/** One problem as a self-contained instruction an AI can follow without knowing uxqa. */
function promptBlock(violation: Violation, index: number): string[] {
  const pageOnly = violation.line === 0;
  const guidance = issueGuidance(violation);
  const lines = [`问题 ${index}${PRIORITY[violation.level]}：${violation.name}`];
  lines.push(pageOnly ? `- 位置：${violation.file}（页面上看到的问题，没能确定是哪一行代码；请在代码里搜索这段文字：${violation.snippet || '见下面的说明'}）` : `- 位置：${violation.file}:${violation.line}（第 ${violation.line} 行）`);
  lines.push(`- 分类：${guidance.label}；证据：${guidance.evidence}`);
  if (!pageOnly && violation.snippet) lines.push(`- 现在的代码：${violation.snippet}`);
  lines.push(`- 问题：${violation.what}`);
  lines.push(`- 要改成：${violation.fix}`);
  if (violation.suggestion) lines.push(`- 引入方式：${violation.suggestion.importHint}`);
  lines.push(`- 为什么：${violation.consequence}`);
  lines.push(`- 处理原则（${guidance.guide.title}）：${guidance.guide.fix}`);
  lines.push(`- 复检要求：${guidance.guide.verify}`);
  if (violation.ai) lines.push(`- 看图复核（${violation.ai.by}）：${violation.ai.verdict === 'real' ? '截图里确实有这个问题' : violation.ai.verdict === 'not-real' ? '截图里看起来没有这个问题，请先确认再决定改不改' : '截图里看不准'}${violation.ai.reason ? `——${violation.ai.reason}` : ''}`);
  if (violation.origin === 'ai') lines.push('- 来源：这是看截图时发现的问题，不是程序规则查出来的；请先在页面上确认。');
  if (violation.plan?.length) lines.push('- 合并方案：', ...violation.plan.map((step) => `  ${step}`));
  return lines;
}

/** Problems a screenshot review called "not really there" go last, so the AI fixes the certain ones first. */
function reviewOrder(problems: Violation[]): Violation[] {
  return [...problems.filter((violation) => violation.ai?.verdict !== 'not-real'), ...problems.filter((violation) => violation.ai?.verdict === 'not-real')];
}

function promptRules(libraryPath?: string): string[] {
  return [
    '修改要求：',
    '- 只改下面列出的地方，不要顺手改别的代码。',
    `- 能用组件库${libraryPath ? `（${libraryPath}）` : ''}里现成的组件就用现成的，不要自己再写一个样子差不多的。`,
    '- 如果组件库里的组件满足不了需求，先停下来告诉我缺什么（例如需要一个新的样式选项），不要在页面里自己写一份。',
    '- 不要新增写死的颜色和尺寸，用项目里已有的颜色和尺寸档位。',
  ];
}

function promptAfter(result: CheckResult, problems: Violation[]): string[] {
  const codeFiles = [...new Set(problems.filter((violation) => violation.line > 0).map((violation) => violation.file))];
  const lines = ['', '全部改完后：'];
  if (codeFiles.length) lines.push(`- 运行 uxqa check --source ${result.productRoot} --files ${codeFiles.join(' ')} 确认这些问题都没有了。`);
  if (problems.some((violation) => violation.line === 0 || violation.rule.startsWith('visual/'))) lines.push('- 页面上的问题（换行、对齐、遮挡等）请在 uxqa 控制台里点"开始检测"再看一遍。');
  lines.push('- 告诉我改了哪些文件、每处是怎么改的；有没改的，说明原因。');
  return lines;
}

/** Instructions for a coding agent, readable by a beginner: what to fix, where, how, and how to confirm. */
export function formatPrompt(result: CheckResult, options: { limit?: number } = {}): string {
  const fresh = reviewOrder(result.violations.filter((violation) => violation.status === 'new'));
  if (!fresh.length) return '这一轮没有需要修改的问题。\n';
  const limit = options.limit ?? 50;
  const shown = fresh.slice(0, limit);
  const counts = (['must', 'default', 'reference'] as const).map((level) => [level, shown.filter((violation) => violation.level === level).length] as const).filter(([, count]) => count);
  const lines = [
    `请帮我修改这个项目（${result.productRoot}）的前端代码，解决下面 ${shown.length} 个问题（${counts.map(([level, count]) => `${PRIORITY[level].slice(1, -1)} ${count} 个`).join('，')}）。先改标着【需要改】的。`,
    '',
    ...promptRules(result.library.path),
  ];
  shown.forEach((violation, index) => { lines.push('', ...promptBlock(violation, index + 1)); });
  if (fresh.length > limit) lines.push('', `（还有 ${fresh.length - limit} 个问题没列出来，先改完这些，再检测一次。）`);
  if (result.rules.guidance.length) {
    lines.push('', '项目的其他要求（请一并遵守）：');
    for (const entry of result.rules.guidance) lines.push(`- ${entry.text}`);
  }
  lines.push(...promptAfter(result, shown));
  return `${lines.join('\n')}\n`;
}

/** The same instructions for a single problem. */
export function formatSinglePrompt(result: CheckResult, violation: Violation): string {
  return `${[
    `请帮我修改这个项目（${result.productRoot}）的前端代码，解决下面这个问题。`,
    '',
    ...promptRules(result.library.path),
    '',
    ...promptBlock(violation, 1),
    ...promptAfter(result, [violation]),
  ].join('\n')}\n`;
}
