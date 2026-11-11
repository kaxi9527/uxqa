import { GUIDES } from './guides.js';
export { GUIDES, DOMAIN_LABELS, MODE_LABELS } from './guides.js';

/** UXQA-authored procedures feed runtime diagnosis without external checkouts. */
export function screenshotGuidance(): string[] {
  return GUIDES.filter((guide) => guide.modes.includes('ai-review')).map((guide) => `[${guide.domain} · ${guide.title}] ${guide.summary} ${guide.checks.join(' ')}`);
}
