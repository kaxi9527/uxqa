import { HINT_RULES } from '../check/hints.js';
import { VISUAL_RULES } from '../visual/rules.js';
import { BASIC_RULES } from './load.js';
import type { RuleLevel, RuleSet } from './types.js';

/** Every built-in rule as one plain sentence ("what we ask for") and why it matters, for the rule switches in the console. */
export interface CatalogEntry { id: string; kind: 'code' | 'page'; rule: string; why: string; defaultLevel: Exclude<RuleLevel, 'off'>; level: RuleLevel; reason?: string }

const CODE: Record<string, [string, string]> = {
  'basic/use-library-component': ['组件库里有的按钮、输入框、弹窗等，必须用组件库的，不要手写', '手写的样子和用法会和其他页面不一致，以后改一处要改很多处。'],
  'basic/no-duplicate-component': ['不要再写一个和组件库同名的组件', '两个同名组件会让人和 AI 都用错，改了一个另一个不跟着变。'],
  'basic/no-hardcoded-color': ['颜色用项目统一定义的，不要直接写色值', '换主题色、做深色模式时，写死的颜色不会跟着变。'],
  'basic/no-arbitrary-size': ['间距、字号、圆角用统一档位，不要随手写像素', '各处尺寸会慢慢对不齐。'],
  'basic/repeated-pattern': ['同样的写法出现多次，就做成组件', '复制出来的几份以后很难一起改。'],
};
const HINT_SENTENCE: Record<string, string> = {
  'basic/img-alt': '图片要写说明文字（alt）',
  'basic/icon-button-name': '只有图标的按钮要写名字（aria-label）',
  'basic/clickable-needs-button': '能点的东西要用按钮或链接，不要给 div 绑点击',
  'basic/link-needs-href': '链接要有真实地址；点了是做操作就用按钮',
  'basic/new-window-safety': '新窗口打开的链接要加 rel="noopener noreferrer"',
  'basic/no-positive-tabindex': '不要强行修改 Tab 键顺序（tabIndex 大于 0）',
  'basic/no-autofocus': '少用"一打开就自动聚焦"',
  'basic/input-needs-label': '每个输入框都要有标签',
  'basic/button-type-in-form': '表单里的按钮要写 type',
  'basic/iframe-title': '嵌入的页面（iframe）要写标题',
  'basic/image-size': '图片要写宽高，避免加载时页面跳动',
  'basic/keep-focus-outline': '不要去掉键盘焦点框（或要有替代样式）',
  'basic/no-transition-all': '动画只写需要动的属性，不要写 transition: all',
  'basic/no-important': '少用 !important',
  'basic/no-huge-z-index': '层级（z-index）用统一档位，不要写成几千几万',
  'basic/no-wide-fixed-width': '不要写死很大的宽度，窄屏会被撑破',
  'basic/allow-zoom': '不要禁止用户放大页面',
  'basic/page-language': '页面要写语言（<html lang>）',
};
const PAGE: Record<string, [string, string]> = {
  'visual/no-wrap': ['按钮、标签、标签页的文字始终一行', '一换行按钮就变高，一排高矮不齐。'],
  'visual/no-clip': ['文字不能被截掉', '用户看不全写的是什么。'],
  'visual/no-overlap': ['内容不能叠在一起', '互相遮挡，看不清也点不到。'],
  'visual/no-horizontal-scroll': ['页面不能左右滚动', '窄屏时内容被挤到屏幕外。'],
  'visual/image-loads': ['图片都要能加载出来', '破图让页面看起来像坏了。'],
  'visual/same-row-same-size': ['同一排的按钮和输入框一样高', '高矮不齐看起来没对齐。'],
  'visual/same-row-aligned': ['同一排的控件上下居中对齐', '参差不齐显得不规整。'],
  'visual/same-row-same-height': ['同一排的卡片一样高', '版面显得乱。'],
  'visual/min-font-size': ['字号不小于 11px', '太小的字很难看清。'],
  'visual/min-tap-area': ['能点的地方至少 24×24', '太小不容易点中。'],
  'visual/no-title-orphan': ['标题最后一行不要只剩一个字', '孤字很难看。'],
  'visual/min-contrast': ['文字和背景要有足够对比（至少 4.5）', '颜色太淡很多人看不清。'],
  'visual/no-text-overflow': ['文字不能跑出它的框', '会压到旁边的内容上。'],
  'visual/image-not-stretched': ['图片不能被拉变形', '人像、Logo 被压扁很不专业。'],
  'visual/consistent-button-height': ['一页里的按钮高度不超过 4 种', '大小没有规律，不像一套设计。'],
  'visual/comfortable-line-height': ['多行文字的行高至少是字号的 1.2 倍', '行距太挤读起来很累。'],
  'visual/few-font-sizes': ['一页里的字号不超过 8 种', '字号太杂，页面没有层次。'],
  'visual/consistent-radius': ['一页里的按钮圆角不超过 3 种', '看起来像拼凑出来的。'],
  'visual/opener-works': ['菜单、弹窗、下拉框、标签页、折叠区都点开再检查一遍；点了没反应的要报出来（关闭这条就不点开）', '打开后的界面也会有换行、截断、遮挡；标着能打开却打不开的按钮会让人以为坏了。'],
  'visual/long-text-safe': ['文字加长约 60% 时界面也不坏（模拟翻译和长内容）', '换语言或内容变长时按钮折行、文字被截掉。'],
};

export function ruleCatalog(ruleSet: RuleSet): CatalogEntry[] {
  const active = new Map(ruleSet.rules.map((rule) => [rule.id, rule]));
  const off = new Map(ruleSet.disabled.map((entry) => [entry.id, entry.reason]));
  const visual = new Map(ruleSet.visual.map((entry) => [entry.id, entry]));
  const code = BASIC_RULES.map((rule): CatalogEntry => {
    const hint = rule.check ? HINT_RULES[rule.check] : undefined;
    const [sentence, why] = hint ? [HINT_SENTENCE[rule.id] ?? hint.title, hint.consequence] : CODE[rule.id] ?? [rule.fix ?? rule.id, ''];
    const current = active.get(rule.id);
    return { id: rule.id, kind: 'code', rule: sentence, why, defaultLevel: rule.level as CatalogEntry['defaultLevel'], level: current ? current.level : 'off', ...(off.has(rule.id) ? { reason: off.get(rule.id) } : current?.reason ? { reason: current.reason } : {}) };
  });
  const page = Object.values(VISUAL_RULES).map((rule): CatalogEntry => {
    const [sentence, why] = PAGE[rule.id] ?? [rule.title, ''];
    const override = visual.get(rule.id);
    return { id: rule.id, kind: 'page', rule: sentence, why, defaultLevel: rule.level, level: override?.level ?? rule.level, ...(override?.reason ? { reason: override.reason } : {}) };
  });
  return [...code, ...page];
}
