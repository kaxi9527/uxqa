import ts from 'typescript';
import type { RuleLevel } from '../rules/types.js';

/**
 * Small, well-known front-end mistakes that can be read straight from source (JSX, CSS, index.html).
 * Picked from eslint-plugin-jsx-a11y, the Vercel Web Interface Guidelines and common UI QA checklists,
 * limited to the ones a beginner's AI-written page actually gets wrong and that have a clear fix.
 */
export type HintCheck =
  | 'img-alt' | 'icon-button-name' | 'click-without-button' | 'link-href' | 'blank-rel' | 'positive-tabindex' | 'autofocus'
  | 'input-label' | 'form-button-type' | 'iframe-title' | 'img-size'
  | 'outline-none' | 'transition-all' | 'important' | 'huge-z-index' | 'wide-fixed-width'
  | 'zoom-disabled' | 'page-language';

export interface Hint { check: HintCheck; tag?: string; text?: string; detail?: string; classes?: string[] }

interface HintRule {
  id: string;
  level: Exclude<RuleLevel, 'off'>;
  /** Category shown as the group name. */
  title: string;
  name: (hint: Hint) => string;
  what: (hint: Hint) => string;
  consequence: string;
  fix: (hint: Hint) => string;
}

const q = (text?: string) => (text ? `「${[...text].length > 12 ? `${[...text].slice(0, 12).join('')}…` : text}」` : '');
const thing = (hint: Hint, fallback: string) => `${q(hint.text)}${hint.tag && !/^[a-z]/.test(hint.tag) ? `${hint.tag} 组件` : fallback}`;

export const HINT_RULES: Record<HintCheck, HintRule> = {
  'img-alt': {
    id: 'basic/img-alt', level: 'must', title: '图片没写说明文字',
    name: () => '图片没写说明文字（alt）',
    what: () => '这张图片没有写 alt。',
    consequence: '图片加载失败时什么都不显示；用读屏软件的人不知道这是什么图。',
    fix: () => '加上 alt，写一句图片内容，例如 alt="团队合影"；纯装饰的图片写 alt=""。',
  },
  'icon-button-name': {
    id: 'basic/icon-button-name', level: 'must', title: '图标按钮没有名字',
    name: (hint) => `只有图标的${hint.tag === 'a' ? '链接' : hint.tag && !/^[a-z]/.test(hint.tag) ? ` ${hint.tag} 组件` : '按钮'}没有名字`,
    what: () => '这个按钮里只有图标，没有文字，也没有写 aria-label。',
    consequence: '用读屏软件的人只听到"按钮"，不知道点了会做什么；鼠标悬停也没有提示。',
    fix: () => '加上 aria-label 写清用途，例如 aria-label="关闭"；需要的话再加 title 作为悬停提示。',
  },
  'click-without-button': {
    id: 'basic/clickable-needs-button', level: 'must', title: '能点的东西不是按钮',
    name: (hint) => `${q(hint.text)}能点击，却用 <${hint.tag}> 写的`,
    what: (hint) => `这个 <${hint.tag}> 绑了点击事件，但它不是按钮。`,
    consequence: '用键盘的人按 Tab 选不到它，按回车也没反应；读屏软件不会告诉用户这里能点。',
    fix: () => '换成组件库里的 Button（或 <button type="button">）；如果点击后是跳到别的页面，用链接组件。',
  },
  'link-href': {
    id: 'basic/link-needs-href', level: 'default', title: '链接没有真正的地址',
    name: (hint) => `${thing(hint, '链接')}的地址是空的`,
    what: (hint) => `这个链接${hint.detail ? `的地址写的是 ${hint.detail}` : '没有写 href'}，不会真正跳转。`,
    consequence: '不能用"在新标签页打开"，按回车可能没反应；如果它其实是个按钮，读屏软件会读错。',
    fix: () => '跳转到别的页面就写真实地址（或用路由的 Link 组件）；点了是执行操作就换成 Button。',
  },
  'blank-rel': {
    id: 'basic/new-window-safety', level: 'default', title: '新窗口链接缺少安全设置',
    name: (hint) => `${thing(hint, '链接')}在新窗口打开，但没写 rel`,
    what: () => '这个链接用 target="_blank" 在新窗口打开，却没有写 rel="noopener noreferrer"。',
    consequence: '被打开的网页能反过来控制当前页面（例如偷偷换成钓鱼页）。',
    fix: () => '加上 rel="noopener noreferrer"。',
  },
  'positive-tabindex': {
    id: 'basic/no-positive-tabindex', level: 'default', title: '强行改了 Tab 键顺序',
    name: (hint) => `${q(hint.text)}强行设成了第 ${hint.detail} 个被 Tab 选中`,
    what: (hint) => `这里写了 tabIndex=${hint.detail}，大于 0。`,
    consequence: '按 Tab 键时焦点会先跳到这里，再跳回页面开头，顺序乱掉。',
    fix: () => '删掉 tabIndex，或者改成 0；想调整顺序就调整元素在页面里的先后。',
  },
  autofocus: {
    id: 'basic/no-autofocus', level: 'reference', title: '一打开就抢焦点',
    name: (hint) => `${thing(hint, '输入框')}一打开页面就自动获得焦点`,
    what: () => '这里写了 autoFocus。',
    consequence: '读屏软件会跳过前面的内容；在手机上会突然弹出键盘、页面跳动。',
    fix: () => '除非这一页只有这一个输入框（例如搜索页、登录弹窗），否则去掉 autoFocus。',
  },
  'input-label': {
    id: 'basic/input-needs-label', level: 'default', title: '输入框没有标签',
    name: (hint) => `${hint.detail ? `「${hint.detail}」` : ''}${hint.tag === 'select' ? '下拉框' : hint.tag === 'textarea' ? '多行输入框' : '输入框'}没有标签`,
    what: () => '这个输入框没有对应的 <label>，也没有写 aria-label。提示文字（placeholder）一输入就消失，不能代替标签。',
    consequence: '用户输入后就忘了这一栏是填什么的；读屏软件读不出这一栏的名字；点文字也不能选中输入框。',
    fix: () => '用组件库的 Label（或 <label htmlFor="这个输入框的 id">）写上名字；放不下可见标签时至少写 aria-label。',
  },
  'form-button-type': {
    id: 'basic/button-type-in-form', level: 'default', title: '表单里的按钮没写类型',
    name: (hint) => `表单里的${q(hint.text)}按钮没写 type`,
    what: () => '这个 <button> 在 <form> 里面，但没有写 type。',
    consequence: '没写 type 的按钮默认是"提交"：点"取消""加一行"之类的按钮也会把表单提交出去。',
    fix: () => '提交按钮写 type="submit"，其他按钮写 type="button"。',
  },
  'iframe-title': {
    id: 'basic/iframe-title', level: 'default', title: '嵌入的页面没有标题',
    name: () => '嵌入的页面（iframe）没有标题',
    what: () => '这个 <iframe> 没有写 title。',
    consequence: '读屏软件只会说"框架"，用户不知道里面是什么。',
    fix: () => '加上 title，写清里面是什么，例如 title="付款表单"。',
  },
  'img-size': {
    id: 'basic/image-size', level: 'reference', title: '图片没写尺寸',
    name: () => '图片没写宽高，加载时页面会跳',
    what: () => '这张图片没有写宽高（width/height 属性或尺寸类名）。',
    consequence: '图片加载出来之前不占位置，加载完把下面的内容往下推，用户容易点错。',
    fix: () => '写上 width 和 height（按图片原始比例），或用类名固定尺寸 / 比例（例如 aspect-video）。',
  },
  'outline-none': {
    id: 'basic/keep-focus-outline', level: 'must', title: '去掉了键盘焦点框',
    name: (hint) => `${hint.text ? `${q(hint.text)}的` : ''}键盘焦点框被去掉了`,
    what: (hint) => `这里写了 ${hint.detail ?? 'outline: none'}，却没有用别的样式（例如 focus-visible 时的描边）代替。`,
    consequence: '用键盘操作的人看不出现在选中的是哪一个。',
    fix: () => '删掉这一句；或者在 :focus-visible 时加上明显的描边（Tailwind 写 focus-visible:ring-2）。',
  },
  'transition-all': {
    id: 'basic/no-transition-all', level: 'reference', title: '动画用了 transition: all',
    name: () => '动画过渡写成了 all',
    what: (hint) => `这里写了 ${hint.detail ?? 'transition: all'}。`,
    consequence: '宽高、位置这些不该动的属性也会跟着做动画，页面会抖、会卡。',
    fix: () => '只写需要动画的属性，例如 transition: opacity 0.2s, transform 0.2s（Tailwind 用 transition-colors / transition-opacity / transition-transform）。',
  },
  important: {
    id: 'basic/no-important', level: 'reference', title: '用 !important 强行覆盖样式',
    name: (hint) => `用 !important 强行覆盖样式${hint.detail ? `（${hint.detail}）` : ''}`,
    what: () => '这里用 !important 强行压过其他样式。',
    consequence: '以后组件库调整样式时这里不跟着变，想改它只能再写一个 !important，越改越乱。',
    fix: () => '去掉 !important，查清是哪条样式在冲突，改用组件自带的样式选项（variant）或更具体的写法。',
  },
  'huge-z-index': {
    id: 'basic/no-huge-z-index', level: 'default', title: '层级数字写得过大',
    name: (hint) => `层级（z-index）写成了 ${hint.detail}`,
    what: (hint) => `这里把 z-index 设成了 ${hint.detail}。`,
    consequence: '层级会越写越大地互相"比大小"，弹窗、下拉菜单最后会被它挡住。',
    fix: () => '用项目统一的层级档位（例如 Tailwind 的 z-10 / z-20 / z-50），弹窗和下拉菜单交给组件库处理。',
  },
  'wide-fixed-width': {
    id: 'basic/no-wide-fixed-width', level: 'default', title: '写死了很大的宽度',
    name: (hint) => `${hint.text ? `${q(hint.text)}的` : ''}宽度写死成 ${hint.detail}`,
    what: (hint) => `这里把宽度固定成 ${hint.detail}，比小屏幕还宽。`,
    consequence: '窗口变窄时内容会被撑出屏幕，出现左右滚动条或被截掉。',
    fix: () => '改成 max-width（例如 max-w-3xl / max-width: 720px）配合 width: 100%，让它在窄屏时能缩小。',
  },
  'zoom-disabled': {
    id: 'basic/allow-zoom', level: 'must', title: '禁止了页面缩放',
    name: () => '页面禁止了用户放大',
    what: (hint) => `index.html 的 viewport 写了 ${hint.detail}。`,
    consequence: '眼神不好的人在手机上没法放大看字。',
    fix: () => '把 viewport 改成 <meta name="viewport" content="width=device-width, initial-scale=1">。',
  },
  'page-language': {
    id: 'basic/page-language', level: 'reference', title: '页面没写语言',
    name: () => '页面没写是什么语言',
    what: () => '<html> 标签没有写 lang。',
    consequence: '读屏软件可能用英文读中文；浏览器会误弹"翻译此页"。',
    fix: () => '中文页面写 <html lang="zh-CN">。',
  },
};

// ---------- JSX ----------

export const ICONISH = /^(svg|img|i)$|Icon$|^Lucide|^[A-Z][A-Za-z]*$/;
export const NAMED_BY = ['aria-label', 'aria-labelledby', 'title'];

function attributeText(attribute: ts.JsxAttribute | undefined): string | undefined {
  const initializer = attribute?.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    if (ts.isStringLiteralLike(initializer.expression)) return initializer.expression.text;
    if (ts.isNumericLiteral(initializer.expression)) return initializer.expression.text;
  }
  return undefined;
}

function hasSpread(node: ts.JsxOpeningLikeElement): boolean {
  return node.attributes.properties.some((property) => ts.isJsxSpreadAttribute(property));
}

/** The nearest JSX ancestor element whose tag matches. */
function inside(node: ts.Node, source: ts.SourceFile, test: (tag: string) => boolean): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxElement(current) && test(current.openingElement.tagName.getText(source))) return true;
    if (ts.isFunctionLike(current) && !ts.isArrowFunction(current)) return false;
  }
  return false;
}

/** Children are only self-closing elements (icons), no text and no `{expression}` that could hold a label. */
function onlyIcons(node: ts.JsxOpeningLikeElement, source: ts.SourceFile): boolean {
  if (!ts.isJsxOpeningElement(node) || !ts.isJsxElement(node.parent)) return false;
  let icons = 0;
  for (const child of node.parent.children) {
    if (ts.isJsxText(child)) { if (child.text.trim()) return false; continue; }
    if (ts.isJsxSelfClosingElement(child) && ICONISH.test(child.tagName.getText(source))) { icons++; continue; }
    if (ts.isJsxElement(child) && child.openingElement.tagName.getText(source) === 'svg') { icons++; continue; }
    return false;
  }
  return icons > 0;
}

export const BUTTONISH = /^(button|Button|IconButton)$|Button$/;

export function jsxHints(node: ts.JsxOpeningLikeElement, attributes: Map<string, ts.JsxAttribute>, classes: string[], source: ts.SourceFile, text?: string): Hint[] {
  const tag = node.tagName.getText(source);
  const intrinsic = /^[a-z][a-z0-9]*$/.test(tag);
  const spread = hasSpread(node);
  const has = (name: string) => attributes.has(name);
  // Custom components often take the accessible name as a prop (label="第一页", tooltip="关闭").
  const named = NAMED_BY.some(has) || (!intrinsic && [...attributes.keys()].some((name) => /label|title|tooltip|^text$|^name$|srText/i.test(name)));
  const hints: Hint[] = [];
  const base = { tag, ...(text ? { text } : {}), classes };

  if (tag === 'img' && !has('alt') && !spread) hints.push({ check: 'img-alt', ...base });
  if (tag === 'img' && !spread && !(has('width') && has('height')) && !classes.some((name) => /^(w|h|size|aspect)-/.test(name.replace(/^[a-z]+:/, '')))) hints.push({ check: 'img-size', ...base });
  if ((BUTTONISH.test(tag) || tag === 'a') && !named && !spread && onlyIcons(node, source)) hints.push({ check: 'icon-button-name', ...base });
  if (intrinsic && ['div', 'span', 'li', 'p', 'img', 'td', 'tr', 'section', 'article'].includes(tag) && has('onClick') && !spread) {
    const role = attributeText(attributes.get('role'));
    if (!role || !['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'switch', 'radio', 'presentation', 'none'].includes(role)) hints.push({ check: 'click-without-button', ...base });
  }
  if (tag === 'a' && !spread) {
    const href = attributeText(attributes.get('href'));
    if (!has('href')) hints.push({ check: 'link-href', ...base });
    else if (href !== undefined && (href === '#' || href === '' || /^javascript:/i.test(href))) hints.push({ check: 'link-href', ...base, detail: href || '空字符串' });
  }
  if (attributeText(attributes.get('target')) === '_blank' && !spread) {
    const rel = attributeText(attributes.get('rel'));
    if (!has('rel') || (rel !== undefined && !/noopener|noreferrer/.test(rel))) hints.push({ check: 'blank-rel', ...base });
  }
  const tabIndex = Number(attributeText(attributes.get('tabIndex')) ?? attributeText(attributes.get('tabindex')));
  if (tabIndex > 0) hints.push({ check: 'positive-tabindex', ...base, detail: String(tabIndex) });
  if (has('autoFocus') || has('autofocus')) hints.push({ check: 'autofocus', ...base });
  if (intrinsic && ['input', 'select', 'textarea'].includes(tag) && !spread && !named && !has('id')) {
    const type = attributeText(attributes.get('type'));
    if (!['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type ?? '') && !classes.includes('hidden') && !classes.includes('sr-only') && !inside(node, source, (name) => /^label$|Label$/.test(name))) {
      const placeholder = attributeText(attributes.get('placeholder'));
      hints.push({ check: 'input-label', ...base, ...(placeholder ? { detail: placeholder } : {}) });
    }
  }
  if (tag === 'button' && !has('type') && !spread && inside(node, source, (name) => name === 'form')) hints.push({ check: 'form-button-type', ...base });
  if (tag === 'iframe' && !has('title') && !spread) hints.push({ check: 'iframe-title', ...base });
  // Removing the outline only matters on things that can take keyboard focus.
  const focusable = (intrinsic && ['button', 'a', 'summary', 'select'].includes(tag)) || (intrinsic && tag === 'input' && ['checkbox', 'radio', 'submit', 'button', 'range'].includes(attributeText(attributes.get('type')) ?? ''))
    || has('tabIndex') || (!intrinsic && /Button|Link|Trigger|Tab$|Tabs?Trigger|Checkbox|Switch|Radio|Toggle/.test(tag)) || ['button', 'link', 'tab', 'checkbox', 'switch'].includes(attributeText(attributes.get('role')) ?? '');
  hints.push(...classHints(classes, text).filter((hint) => hint.check !== 'outline-none' || focusable));
  return hints;
}

/** Tailwind class names on one element. */
export function classHints(classes: string[], text?: string): Hint[] {
  const hints: Hint[] = [];
  const base = { ...(text ? { text } : {}), classes };
  const bare = classes.map((name) => name.split(':').pop()!);
  const removed = classes.find((name) => /(^|:)outline-none$/.test(name) || /(^|:)outline-0$/.test(name));
  const replaced = classes.some((name) => /(^|:)(focus|focus-visible|focus-within):(ring|outline|border|shadow|bg|underline)/.test(name) && !/outline-(none|0)$/.test(name));
  if (removed && !replaced) hints.push({ check: 'outline-none', ...base, detail: removed });
  if (bare.includes('transition-all')) hints.push({ check: 'transition-all', ...base, detail: 'transition-all' });
  const forced = classes.find((name) => /(^|:)!/.test(name) || /!$/.test(name));
  if (forced) hints.push({ check: 'important', ...base, detail: forced });
  const z = classes.map((name) => name.match(/(?:^|:)z-\[(\d+)\]$/)).find((match) => match && Number(match[1]) >= 1000);
  if (z) hints.push({ check: 'huge-z-index', ...base, detail: z[1] });
  return hints;
}

/** Fixed widths wide enough to overflow a small screen (Tailwind `w-[1200px]`, style `width: 1200`). */
export function wideWidth(prefix: string | undefined, px: number): boolean {
  return (prefix === 'w' || prefix === 'min-w') && px >= 480;
}

// ---------- CSS ----------

export function cssHints(text: string): Array<Hint & { line: number }> {
  const hints: Array<Hint & { line: number }> = [];
  const lineAt = (index: number) => text.slice(0, index).split('\n').length;
  let important = 0;
  let firstImportant = 0;
  for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = block[2];
    const at = (pattern: RegExp) => { const match = pattern.exec(body); return match ? lineAt((block.index ?? 0) + block[1].length + 1 + match.index) : 0; };
    const outline = /(?<![\w-])outline\s*:\s*(none|0)\b/i;
    if (outline.test(body) && !/:not\(\s*:focus-visible\s*\)/.test(selector) && !/box-shadow|(?<![\w-])border(-color)?\s*:|outline-offset/i.test(body)
      && selector.split(',').some((part) => /:focus/.test(part) || /^\s*(\*|button|a|input|select|textarea)\s*$/.test(part))) {
      hints.push({ check: 'outline-none', detail: `${selector.split(',')[0].trim()} { outline: none }`, line: at(outline) });
    }
    const transition = /(?<![\w-])transition(-property)?\s*:\s*all\b/i;
    if (transition.test(body)) hints.push({ check: 'transition-all', detail: 'transition: all', line: at(transition) });
    const z = body.match(/(?<![\w-])z-index\s*:\s*(\d+)/i);
    if (z && Number(z[1]) >= 1000) hints.push({ check: 'huge-z-index', detail: z[1], line: at(/(?<![\w-])z-index\s*:/i) });
    const width = body.match(/(?<![\w-])(min-)?width\s*:\s*(\d+(?:\.\d+)?)px/i);
    if (width && Number(width[2]) >= 480 && !/@media|@container/.test(selector)) hints.push({ check: 'wide-fixed-width', detail: `${width[2]}px`, line: at(/(?<![\w-])(min-)?width\s*:/i) });
    for (const match of body.matchAll(/!important/g)) {
      if (!important) firstImportant = lineAt((block.index ?? 0) + block[1].length + 1 + (match.index ?? 0));
      important++;
    }
  }
  // One note per file: dozens of !important lines are one habit, not dozens of problems.
  if (important) hints.push({ check: 'important', detail: important > 1 ? `这个文件里共 ${important} 处` : undefined, line: firstImportant });
  return hints;
}

// ---------- index.html ----------

export function htmlHints(text: string): Array<Hint & { line: number }> {
  const hints: Array<Hint & { line: number }> = [];
  const lineAt = (index: number) => text.slice(0, index).split('\n').length;
  const viewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.exec(text);
  if (viewport) {
    const content = viewport[0].match(/content=["']([^"']*)["']/i)?.[1] ?? '';
    const blocked = content.match(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0+)?(?![\d.])/i);
    if (blocked) hints.push({ check: 'zoom-disabled', detail: blocked[0], line: lineAt(viewport.index) });
  }
  const html = /<html\b[^>]*>/i.exec(text);
  if (html && !/\slang=["'][^"']+["']/i.test(html[0])) hints.push({ check: 'page-language', line: lineAt(html.index) });
  return hints;
}
