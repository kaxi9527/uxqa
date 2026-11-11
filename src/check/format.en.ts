import { localizedGuide } from '../guidance/guides.en.js';
import { issueGuidance } from '../guidance/issues.js';
import type { CheckResult, Violation } from './run.js';

const LEVELS: Record<Violation['level'], string> = { must: 'Must fix', default: 'Should fix', reference: 'Advisory' };

function englishBlock(violation: Violation, index: number): string[] {
  const message = violation.english ?? violation;
  const guide = localizedGuide(issueGuidance(violation).guide, 'en');
  const pageOnly = violation.line === 0;
  const lines = [
    `Issue ${index} [${LEVELS[violation.level]}]: ${message.name}`,
    pageOnly ? `- Location: ${violation.file}. The source line was not determined; locate it on the page or search for: ${violation.snippet || 'the description below'}.` : `- Location: ${violation.file}:${violation.line}`,
    ...(violation.snippet && !pageOnly ? [`- Current code: ${violation.snippet}`] : []),
    `- Finding: ${message.what}`,
    `- Suggested change: ${message.fix}`,
    ...(violation.suggestion ? [`- Import: ${violation.suggestion.importHint}`] : []),
    `- Why: ${message.consequence}`,
    `- Guidance (${guide.title}): ${guide.fix}`,
    `- Verify: ${guide.verify}`,
  ];
  if (!violation.english && violation.origin !== 'manual') lines.push('- This finding is preserved in its original language.');
  if (violation.ai) lines.push(`- AI review (${violation.ai.by}): ${violation.ai.verdict}${violation.ai.reason ? ` — ${violation.ai.reason}` : ''}`);
  if (violation.origin === 'ai') lines.push('- This is an AI screenshot suggestion; confirm it on the page before changing code.');
  if (violation.plan?.length) lines.push('- Original merge plan:', ...violation.plan.map((step) => `  ${step}`));
  return lines;
}

export function formatEnglishPrompt(result: CheckResult, options: { limit?: number; only?: Violation } = {}): string {
  const fresh = options.only ? [options.only] : result.violations.filter((violation) => violation.status === 'new');
  const ordered = [...fresh.filter((violation) => violation.ai?.verdict !== 'not-real'), ...fresh.filter((violation) => violation.ai?.verdict === 'not-real')];
  if (!ordered.length) return 'No new findings in this round.\n';
  const shown = ordered.slice(0, options.limit ?? 50);
  const lines = [
    `Review the following ${shown.length} frontend issue${shown.length === 1 ? '' : 's'} in ${result.productRoot}. Address must-fix items first.`,
    '', 'Constraints:',
    '- Change only the listed areas. Reuse existing project components and design tokens.',
    '- If an existing component cannot meet the need, explain the missing capability before adding another implementation.',
    '- Preserve project-specific rules and verify changes against the same coverage.',
  ];
  shown.forEach((violation, index) => lines.push('', ...englishBlock(violation, index + 1)));
  if (ordered.length > shown.length) lines.push('', `${ordered.length - shown.length} more findings were omitted; recheck after addressing these.`);
  if (result.rules.guidance.length) lines.push('', 'Project guidance (original language):', ...result.rules.guidance.map((entry) => `- ${entry.text}`));
  const files = [...new Set(shown.filter((violation) => violation.line > 0).map((violation) => violation.file))];
  lines.push('', 'After changes:');
  if (files.length) lines.push(`- Run uxqa check --source ${result.productRoot} --files ${files.join(' ')} and inspect the results.`);
  if (shown.some((violation) => violation.line === 0 || violation.rule.startsWith('visual/'))) lines.push('- Run another page check and compare the same page states and viewport widths.');
  lines.push('- Report changed files, verification performed, and any unresolved items.');
  return lines.join('\n') + '\n';
}
