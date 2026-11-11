import { ENGLISH_RULES } from '../rules/catalog.en.js';
import { VISUAL_RULES, type VisualKind } from './rules.js';

const FINDING: Record<VisualKind, string> = {
  'card-density': 'Dense card layout needs a task-based review',
  'unnamed-control': 'Visible control has no accessible name',
  'unlabelled-field': 'Input has no associated label or accessible name',
  'heading-order': 'Heading levels skip a level',
  'transition-all': 'Transition applies to all properties',
  'layout-animation': 'An active animation changes layout properties',
  'reduced-motion': 'Motion continues when reduced motion is requested',
  'text-wrap': 'Control text wraps',
  'text-clipped': 'Text is clipped',
  overlap: 'Content overlaps',
  'page-overflow': 'Page overflows horizontally',
  'image-broken': 'Image failed to load',
  'size-mismatch': 'Controls in the same row have different heights',
  misaligned: 'Controls in the same row are misaligned',
  'card-height': 'Cards in the same row have different heights',
  'tiny-text': 'Text is below the minimum size',
  'small-target': 'Interactive target is too small',
  'title-orphan': 'Heading ends with a single character',
  'low-contrast': 'Text contrast is too low',
  'text-overflow': 'Text extends outside its container',
  'image-stretched': 'Image proportions are distorted',
  'mixed-button-height': 'Page uses many button heights',
  'tight-lines': 'Multiline text has tight line spacing',
  'many-font-sizes': 'Page uses many font sizes',
  'mixed-radius': 'Buttons use inconsistent corner radii',
  'long-text': 'Layout changes when text becomes longer',
  'dead-opener': 'An apparent opener produces no visible change',
};

export function englishVisualFinding(kind: VisualKind, issue: { text: string; detail: string; state?: string }, widths: number[]) {
  const title = FINDING[kind], [fix, consequence] = ENGLISH_RULES[VISUAL_RULES[kind].id];
  const measured = /[\u4e00-\u9fff]/.test(issue.detail)
    ? (issue.detail.match(/H[1-6]|\d+(?:\.\d+)?(?:px|ms|%)?/g) ?? []).join(', ')
    : issue.detail;
  const context = [issue.state ? 'Observed in an opened state.' : '', issue.text ? `Content: “${issue.text}”.` : '', widths.length ? `Viewport widths: ${widths.join(', ')}px.` : '', measured ? `Observed detail: ${measured}.` : ''].filter(Boolean).join(' ');
  return { name: title, title, what: `${title}. ${context}`.trim(), consequence, fix };
}
