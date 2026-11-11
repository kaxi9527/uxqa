import type { Violation } from '../check/run.js';
import { DOMAIN_LABELS, GUIDES } from './guides.js';
import type { IssueDomain } from './types.js';

const TOPICS: Array<[RegExp, string]> = [
  [/card-density/, 'hierarchy'],
  [/control-name|field-label|heading-order/, 'accessibility'],
  [/reduced-motion/, 'motion-accessibility'],
  [/contrast|color|theme/, 'color'],
  [/tap-area|label|accessible|alt-text|keyboard|focus|semantic|button-type/, 'accessibility'],
  [/opener|dead-|dialog|navigation/, 'navigation'],
  [/motion|transition|animation/, 'motion-purpose'],
  [/performance|loading/, 'performance'],
  [/image/, 'assets'],
  [/font|text|wrap|clip|line-height|title-orphan/, 'typography'],
  [/overflow|overlap|responsive|long-text/, 'responsive'],
  [/component|repeat|duplicate|library|variant/, 'components'],
  [/spacing|size|align|height|radius|padding/, 'spacing'],
  [/form|input|validation/, 'forms'],
];

export function issueGuidance(violation: Violation) {
  const topic = TOPICS.find(([pattern]) => pattern.test(violation.rule))?.[1];
  const query = `${violation.name} ${violation.what} ${violation.detail}`.toLowerCase();
  const candidates = GUIDES.filter((entry) => !violation.domain || entry.domain === violation.domain)
    .map((entry) => ({ entry, score: entry.keywords.split(' ').filter((word) => query.includes(word.toLowerCase())).length }))
    .sort((a, b) => b.score - a.score);
  const fallback = violation.domain === 'experience' ? 'motion-purpose' : violation.domain === 'ui' ? 'hierarchy' : 'review';
  const guide = GUIDES.find((entry) => entry.id === topic) ?? (candidates[0]?.score ? candidates[0].entry : GUIDES.find((entry) => entry.id === fallback)!);
  const domain: IssueDomain = violation.domain ?? guide.domain;
  return { domain, label: DOMAIN_LABELS[domain], guide,
    evidence: violation.origin === 'manual' ? '人工观察，尚未自动验证' : violation.origin === 'ai' ? 'AI 看图建议' : violation.rule.startsWith('visual/') ? '网页检查' : '源码检查',
    basis: violation.domain ? '报告分类' : '规则对应的参考分类',
  };
}
