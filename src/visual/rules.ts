import type { Violation } from '../check/run.js';
import type { QualityKind } from './quality.js';

/** Visual rules generalised from the SynNovator redesign; kept free of browser code so rule files can be validated anywhere. */
export type VisualKind = 'text-wrap' | 'text-clipped' | 'overlap' | 'page-overflow' | 'image-broken' | 'size-mismatch' | 'misaligned' | 'card-height' | 'tiny-text' | 'small-target' | 'title-orphan'
  | 'low-contrast' | 'text-overflow' | 'image-stretched' | 'tight-lines' | 'many-font-sizes' | 'mixed-radius' | 'mixed-button-height'
  | 'long-text' | 'dead-opener' | QualityKind;

export const VISUAL_RULES: Record<VisualKind, { id: string; level: Violation['level']; title: string }> = {
  'card-density': { id: 'visual/card-density', level: 'reference', title: '阅读层级需要核对' },
  'unnamed-control': { id: 'visual/control-name', level: 'must', title: '操作缺少名称' },
  'unlabelled-field': { id: 'visual/field-label', level: 'default', title: '输入项没有标签' },
  'heading-order': { id: 'visual/heading-order', level: 'reference', title: '标题结构跳跃' },
  'transition-all': { id: 'visual/transition-properties', level: 'reference', title: '过渡属性范围过大' },
  'layout-animation': { id: 'visual/animation-layout', level: 'reference', title: '布局动画需要测量' },
  'reduced-motion': { id: 'visual/reduced-motion', level: 'default', title: '未响应减弱动态偏好' },
  'text-wrap': { id: 'visual/no-wrap', level: 'must', title: '文字换行了' },
  'text-clipped': { id: 'visual/no-clip', level: 'must', title: '文字被截断了' },
  overlap: { id: 'visual/no-overlap', level: 'must', title: '叠在一起了' },
  'page-overflow': { id: 'visual/no-horizontal-scroll', level: 'must', title: '页面要左右划' },
  'image-broken': { id: 'visual/image-loads', level: 'must', title: '图片没加载' },
  'size-mismatch': { id: 'visual/same-row-same-size', level: 'default', title: '同一排高矮不一' },
  misaligned: { id: 'visual/same-row-aligned', level: 'default', title: '同一排没对齐' },
  'card-height': { id: 'visual/same-row-same-height', level: 'default', title: '同一排卡片高矮不一' },
  'tiny-text': { id: 'visual/min-font-size', level: 'default', title: '字太小' },
  'small-target': { id: 'visual/min-tap-area', level: 'default', title: '点击区太小' },
  'title-orphan': { id: 'visual/no-title-orphan', level: 'reference', title: '标题留了孤字' },
  'low-contrast': { id: 'visual/min-contrast', level: 'must', title: '文字颜色太淡看不清' },
  'text-overflow': { id: 'visual/no-text-overflow', level: 'must', title: '文字跑出了框' },
  'image-stretched': { id: 'visual/image-not-stretched', level: 'default', title: '图片被拉变形' },
  'mixed-button-height': { id: 'visual/consistent-button-height', level: 'default', title: '按钮高度种类太多' },
  'tight-lines': { id: 'visual/comfortable-line-height', level: 'reference', title: '行距太挤' },
  'many-font-sizes': { id: 'visual/few-font-sizes', level: 'reference', title: '字号种类太多' },
  'mixed-radius': { id: 'visual/consistent-radius', level: 'reference', title: '按钮圆角不统一' },
  'long-text': { id: 'visual/long-text-safe', level: 'reference', title: '文字变长就坏了' },
  'dead-opener': { id: 'visual/opener-works', level: 'reference', title: '点了没反应' },
};

export const VISUAL_RULE_IDS = Object.values(VISUAL_RULES).map((rule) => rule.id);

