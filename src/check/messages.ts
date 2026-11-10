import type { DesignToken, Inventory, LibraryComponent } from '../inventory/read.js';

/** Plain-language card: where, what happened, what it causes, how to fix. No jargon in these four fields. */
export interface PlainMessage {
  /** What exactly is wrong here, e.g. "「提交订单」按钮是手写的，应改用 Button". */
  name: string;
  /** The kind of problem, used for grouping and filtering, e.g. "没用组件库". */
  title: string;
  what: string;
  consequence: string;
  fix: string;
}

const SPACING_PREFIX = /^-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|start|end)$/;
const FONT_SIZES: Array<[string, number]> = [['xs', 12], ['sm', 14], ['base', 16], ['lg', 18], ['xl', 20], ['2xl', 24], ['3xl', 30], ['4xl', 36], ['5xl', 48]];

export function isSpacingPrefix(prefix: string | undefined): boolean {
  return !!prefix && SPACING_PREFIX.test(prefix);
}

export function isFontSizePrefix(prefix: string | undefined): boolean {
  return prefix === 'text';
}

function scaleStep(px: number): string {
  const step = Math.round(px / 2) / 2; // Tailwind spacing steps of 4px with half steps.
  return Number.isInteger(step) ? String(step) : step.toFixed(1);
}

/** Nearest standard size in Tailwind's scale, as a plain sentence fragment. Width limits get no guess. */
export function nearestSize(prefix: string | undefined, px: number): string | undefined {
  const phrase = (name: string, value: number) => value === px ? `${name}，大小一样` : `最接近的统一档位 ${name}（${value}px）`;
  if (isFontSizePrefix(prefix)) {
    const [name, value] = FONT_SIZES.reduce((best, entry) => Math.abs(entry[1] - px) < Math.abs(best[1] - px) ? entry : best);
    return phrase(`text-${name}`, value);
  }
  if (isSpacingPrefix(prefix) || prefix === 'w' || prefix === 'h' || prefix === 'size') {
    const step = scaleStep(px);
    return phrase(`${prefix}-${step}`, Number(step) * 4);
  }
  if (prefix?.startsWith('rounded')) {
    const radii: Array<[string, number]> = [['sm', 4], ['md', 6], ['lg', 8], ['xl', 12], ['2xl', 16]];
    const [name, value] = radii.reduce((best, entry) => Math.abs(entry[1] - px) < Math.abs(best[1] - px) ? entry : best);
    return phrase(`${prefix}-${name}`, value);
  }
  return undefined;
}

function hexToRgb(hex: string): [number, number, number] | undefined {
  const value = hex.replace('#', '');
  const full = value.length === 3 || value.length === 4 ? value.slice(0, 3).split('').map((char) => char + char).join('') : value.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return undefined;
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16)) as [number, number, number];
}

/** Closest project colour token to a hard-coded hex value, resolving one level of var() indirection. */
export function nearestColorToken(tokens: DesignToken[], value: string): string | undefined {
  const target = hexToRgb(value);
  if (!target) return undefined;
  const byName = new Map(tokens.map((token) => [token.name, token]));
  let best: { name: string; distance: number } | undefined;
  for (const token of tokens) {
    if (token.kind !== 'color') continue;
    let raw = token.value;
    const reference = raw.match(/^var\(--([a-zA-Z0-9_-]+)\)$/);
    if (reference) raw = byName.get(reference[1])?.value ?? raw;
    const rgb = raw.startsWith('#') ? hexToRgb(raw) : undefined;
    if (!rgb) continue;
    const distance = Math.hypot(rgb[0] - target[0], rgb[1] - target[1], rgb[2] - target[2]);
    const name = token.name.replace(/^color-/, '');
    if (!best || distance < best.distance) best = { name, distance };
  }
  return best && best.distance < 60 ? best.name : undefined;
}

export function describeVariants(component: LibraryComponent): string {
  const axes = Object.entries(component.variants).filter(([, options]) => options.length);
  if (!axes.length) return '';
  return axes.map(([axis, options]) => `${axis === 'variant' ? '样式' : axis === 'size' ? '尺寸' : axis}可选 ${options.join(' / ')}`).join('；');
}

export function importHint(component: LibraryComponent, inventory: Inventory): string {
  // A .vue / .svelte file is imported as its default export.
  if (/\.(vue|svelte)$/.test(component.importPath)) return `import ${component.name} from "${component.importPath}"`;
  const siblings = inventory.components.filter((entry) => entry.file === component.file && entry.name.startsWith(component.name.replace(/(Trigger|List|Content|Item)$/, ''))).map((entry) => entry.name);
  if (siblings.length <= 1) return `import { ${component.name} } from "${component.importPath}"`;
  const shown = siblings.length <= 10 ? siblings : [...siblings.slice(0, 8), '…'];
  return `import { ${shown.join(', ')} } from "${component.importPath}"`;
}

/** A few project colour names to show as examples when no exact nearest colour can be computed. */
export function colorExamples(tokens: DesignToken[], context: 'class' | 'style' | 'css'): string | undefined {
  const names = tokens.filter((token) => token.kind === 'color').map((token) => token.name.replace(/^color-/, ''));
  const preferred = ['primary', 'secondary', 'muted-foreground', 'foreground', 'background', 'border', 'destructive', 'accent'].filter((name) => names.includes(name));
  const picked = (preferred.length ? preferred : names).slice(0, 4);
  if (!picked.length) return undefined;
  return context === 'class' ? `${picked.join('、')}（写成 bg-${picked[0]}、text-${picked[picked.length - 1]} 这样）` : picked.map((name) => `var(--${name})`).join('、');
}

const TAG_LABEL: Record<string, string> = {
  button: '按钮', a: '链接', input: '输入框', textarea: '多行输入框', select: '下拉框', label: '表单标签', table: '表格', thead: '表头', tbody: '表格内容',
  tr: '表格行', td: '单元格', th: '表头格', ul: '列表', ol: '列表', li: '列表项', nav: '导航', header: '页头', footer: '页脚', section: '区块',
  article: '卡片', aside: '侧栏', form: '表单', img: '图片', p: '段落', span: '文字', strong: '加粗文字', h1: '大标题', h2: '标题', h3: '小标题',
  h4: '小标题', h5: '小标题', h6: '小标题', div: '区块', main: '主体区域', dialog: '弹窗', svg: '图标', code: '代码', pre: '代码块', hr: '分隔线',
};

/** Plain name for an element, using its classes to tell a card from a plain block. */
export function elementLabel(tag?: string, classes: string[] = []): string | undefined {
  if (!tag) return undefined;
  if ((tag === 'div' || tag === 'section') && classes.some((name) => name.startsWith('rounded')) && classes.some((name) => name === 'border' || name.startsWith('shadow'))) return '卡片';
  return TAG_LABEL[tag];
}

/** What kind of size a Tailwind prefix or inline style key controls. */
export function sizeKind(prefix?: string, raw?: string): string {
  const key = prefix ?? raw?.split(':')[0] ?? '';
  if (/^(text|fontSize)/.test(key)) return '字号';
  if (/^(leading|lineHeight)/.test(key)) return '行高';
  if (/^(tracking|letterSpacing)/.test(key)) return '字间距';
  if (/^-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|padding|margin|rowGap|columnGap)/.test(key) && !/^(max|min)/.test(key)) return '间距';
  if (/^max-w/.test(key)) return '最大宽度';
  if (/^min-w/.test(key)) return '最小宽度';
  if (/^max-h/.test(key)) return '最大高度';
  if (/^min-h/.test(key)) return '最小高度';
  if (/^w$/.test(key)) return '宽度';
  if (/^h$/.test(key)) return '高度';
  if (/^(rounded|borderRadius)/.test(key)) return '圆角';
  if (/^(top|right|bottom|left|inset|start|end)/.test(key)) return '位置';
  return '尺寸';
}

export function quote(text: string | undefined, max = 14): string {
  if (!text) return '';
  const chars = [...text.trim()];
  return `「${chars.slice(0, max).join('')}${chars.length > max ? '…' : ''}」`;
}

export function pxText(px: number): string {
  return `${Number.isInteger(px) ? px : Number(px.toFixed(1))}px`;
}
