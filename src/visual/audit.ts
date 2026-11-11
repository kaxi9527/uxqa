import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { toPosix } from '../inventory/read.js';
import { listProductFiles } from '../check/scan.js';
import type { Violation } from '../check/run.js';
import type { Capture } from '../capture/pages.js';
import { inspectQuality, qualityDescription } from './quality.js';
import { englishVisualFinding } from './english.js';

/**
 * Page-level visual checks across a width sweep, generalised from the SynNovator redesign rules
 * (special text never wraps, same row same height, no overlap, minimum font size, tap area, title orphans).
 * Every problem is screenshotted at the width where it first appears, with the element boxed.
 */

export const WIDTHS = [1440, 1280, 1024, 820, 768, 600, 480, 390, 360];

import { VISUAL_RULES, type VisualKind } from './rules.js';

export { VISUAL_RULES, VISUAL_RULE_IDS, type VisualKind } from './rules.js';

interface Box { x: number; y: number; width: number; height: number }
interface RawIssue { kind: VisualKind; key: string; label: string; text: string; box: Box; detail: string; boxes?: Box[]; count?: number; classes?: string[]; near?: string[]; /** e.g. 点开「更多」后: the problem only exists in that opened state. */ state?: string }

/** In-page checks, kept as plain JavaScript text so no loader helper leaks into the page. */
const VISUAL_SCRIPT = `() => {
  const out = [];
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01; };
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; };
  const text = (e) => (e.innerText || e.textContent || '').replace(/\\s+/g, ' ').trim();
  const key = (e) => { const parts = []; for (let n = e; n && n !== document.body && parts.length < 5; n = n.parentElement) { const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; parts.unshift(n.tagName.toLowerCase() + (same.length > 1 ? ':' + same.indexOf(n) : '')); } return parts.join('>'); };
  const lines = (e) => {
    const tops = [];
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0.5 && !tops.some((t) => Math.abs(t - r.top) < r.height * 0.5)) tops.push(r.top);
    }
    return tops.length;
  };
  const labelOf = (e) => {
    const role = e.getAttribute('role');
    if (e.tagName === 'INPUT') return e.type === 'checkbox' ? '勾选框' : e.type === 'radio' ? '单选框' : '输入框';
    if (e.tagName === 'SELECT') return '下拉框';
    if (role === 'tab') return '标签页'; if (role === 'menuitem') return '菜单项'; if (role === 'option') return '选项';
    if (e.tagName === 'BUTTON' || role === 'button' || /\\b(btn|button)\\b/i.test(e.className || '')) return '按钮';
    if (e.tagName === 'A') return '链接';
    return '标签';
  };
  // R4: special text never wraps (buttons, tabs, tags, status, pills); card-like composites can opt out.
  const special = [...document.querySelectorAll('button, [role=button], [role=tab], [role=menuitem], a[class*=btn], a[class*=button], [class*=badge], [class*=Badge], [class*=chip], [class*=pill], [class*=tag]:not(svg)')];
  for (const e of special) {
    if (!shown(e) || e.closest('[data-button-wrap=allow]') || e.querySelector('h1,h2,h3,h4,p,img,ul,ol,table,textarea')) continue;
    const t = text(e);
    if (!t || t.length > 40) continue;
    const cs = getComputedStyle(e);
    if (lines(e) > 1) out.push({ el: e, kind: 'text-wrap', key: key(e), label: labelOf(e), text: t, box: box(e), detail: '' });
    else if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') out.push({ el: e, kind: 'text-clipped', key: key(e), label: labelOf(e), text: t, box: box(e), detail: '' });
  }
  // Page must not scroll sideways.
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: 'page-overflow', key: 'html', label: '页面', text: '', box: { x: 0, y: 0, width: document.documentElement.scrollWidth, height: Math.min(document.documentElement.scrollHeight, 900) }, detail: String(document.documentElement.scrollWidth - innerWidth) });
  // Same row: controls equal height and centred; cards in a grid row equal height.
  const isControl = (e) => e.matches('button, input:not([type=checkbox]):not([type=radio]), select, [role=button], [role=combobox], a[class*=btn], a[class*=button]');
  const isCard = (e) => { const cs = getComputedStyle(e); return e.children.length >= 2 && (cs.borderTopWidth !== '0px' || cs.boxShadow !== 'none' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== getComputedStyle(e.parentElement).backgroundColor)); };
  let containers = 0;
  for (const g of document.querySelectorAll('body *')) {
    if (containers > 3000) break;
    const cs = getComputedStyle(g);
    const flexRow = cs.display.includes('flex') && !cs.flexDirection.startsWith('column');
    const grid = cs.display.includes('grid');
    if (!flexRow && !grid) continue;
    containers++;
    const kids = [...g.children].filter(shown);
    if (kids.length < 2) continue;
    const rows = [];
    for (const k of kids) { const r = k.getBoundingClientRect(); const row = rows.find((x) => Math.min(x.bottom, r.bottom) - Math.max(x.top, r.top) > Math.min(x.height, r.height) * 0.5); if (row) { row.items.push(k); row.top = Math.min(row.top, r.top); row.bottom = Math.max(row.bottom, r.bottom); row.height = row.bottom - row.top; } else rows.push({ items: [k], top: r.top, bottom: r.bottom, height: r.height }); }
    for (const row of rows) {
      const controls = row.items.filter(isControl);
      if (controls.length >= 2) {
        const hs = controls.map((c) => c.getBoundingClientRect().height);
        const centers = controls.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
        if (Math.max(...hs) - Math.min(...hs) > 1.5) out.push({ kind: 'size-mismatch', key: key(g), label: '按钮和输入框', text: controls.map(text).filter(Boolean).slice(0, 3).join(' / '), box: box(g), boxes: controls.map(box), detail: hs.map((h) => Math.round(h)).join('/') });
        else if (Math.max(...centers) - Math.min(...centers) > 2) out.push({ kind: 'misaligned', key: key(g), label: '按钮和输入框', text: controls.map(text).filter(Boolean).slice(0, 3).join(' / '), box: box(g), boxes: controls.map(box), detail: String(Math.round(Math.max(...centers) - Math.min(...centers))) });
      }
      const cards = grid ? row.items.filter(isCard) : [];
      if (cards.length >= 2) {
        const hs = cards.map((c) => c.getBoundingClientRect().height);
        if (Math.max(...hs) - Math.min(...hs) > 1.5) out.push({ kind: 'card-height', key: key(g), label: '卡片', text: text(cards[0]).slice(0, 16), box: box(g), boxes: cards.map(box), detail: hs.map((h) => Math.round(h)).join('/') });
      }
      // Siblings must not overlap (absolutely positioned layers are allowed to).
      const flow = row.items.filter((k) => !['absolute', 'fixed'].includes(getComputedStyle(k).position));
      for (let i = 0; i < flow.length; i++) for (let j = i + 1; j < flow.length; j++) {
        const a = flow[i].getBoundingClientRect(), b = flow[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 2 && h > 2 && (text(flow[i]) || text(flow[j]))) { out.push({ kind: 'overlap', key: key(flow[i]) + '|' + key(flow[j]), label: '内容', text: [text(flow[i]), text(flow[j])].filter(Boolean).map((x) => x.slice(0, 10)).join(' 和 '), box: box(g), boxes: [box(flow[i]), box(flow[j])], detail: '' }); }
      }
    }
  }
  // Minimum font size 11px for visible text; tap targets at least 24px; images load; titles keep no single-character last line.
  // Same-styled small text (e.g. every label in an icon grid) is one problem, not dozens.
  const tiny = new Map();
  for (const e of document.querySelectorAll('body *')) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || !shown(e)) continue;
    const size = parseFloat(getComputedStyle(e).fontSize);
    if (size >= 11) continue;
    const signature = e.tagName + '|' + (typeof e.className === 'string' ? e.className : '') + '|' + size;
    const group = tiny.get(signature);
    if (group) { group.count++; if (group.boxes.length < 6) group.boxes.push(box(e)); continue; }
    tiny.set(signature, { count: 1, first: e, boxes: [box(e)], size });
  }
  for (const [signature, group] of tiny) out.push({ el: group.first, kind: 'tiny-text', key: 'tiny:' + signature, label: '文字', text: text(group.first).slice(0, 16), box: box(group.first), boxes: group.boxes, detail: String(group.size), count: group.count });
  const small = new Map();
  for (const e of document.querySelectorAll('a[href], button, input, select, [role=button], [role=tab]')) {
    if (!shown(e) || e.matches('input[type=hidden]')) continue;
    // A control inside its <label> can be clicked anywhere on the label, so the label is the tap area.
    const target = e.matches('input, select') && e.closest('label') ? e.closest('label') : e;
    const r = target.getBoundingClientRect();
    if (!(r.width < 24 || r.height < 24) || e.closest('p, li > a:only-child')) continue;
    const signature = e.tagName + '|' + (typeof e.className === 'string' ? e.className : '') + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
    const group = small.get(signature);
    if (group) { group.count++; if (group.boxes.length < 6) group.boxes.push(box(target)); continue; }
    small.set(signature, { count: 1, first: e, boxes: [box(target)], detail: Math.round(r.width) + '×' + Math.round(r.height) });
  }
  for (const [signature, group] of small) out.push({ el: group.first, kind: 'small-target', key: 'small:' + signature, label: labelOf(group.first), text: text(group.first).slice(0, 16) || group.first.getAttribute('aria-label') || '', box: group.boxes[0], boxes: group.boxes, detail: group.detail, count: group.count });
  for (const i of document.images) if (shown(i) && i.complete && !i.naturalWidth) out.push({ kind: 'image-broken', key: key(i), label: '图片', text: i.alt || i.src.split('/').pop().slice(0, 30), box: box(i), detail: '' });
  for (const hd of document.querySelectorAll('h1, h2, h3')) {
    if (!shown(hd)) continue;
    const t = text(hd); if (t.length < 4) continue;
    const range = document.createRange(); range.selectNodeContents(hd);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5);
    if (rects.length < 2) continue;
    const lastTop = Math.max(...rects.map((r) => r.top));
    const lastWidth = rects.filter((r) => Math.abs(r.top - lastTop) < 2).reduce((sum, r) => sum + r.width, 0);
    if (lastWidth < parseFloat(getComputedStyle(hd).fontSize) * 1.6 && /[\\u3400-\\u9fff]$/.test(t)) out.push({ el: hd, kind: 'title-orphan', key: key(hd), label: '标题', text: t.slice(0, 20), box: box(hd), detail: t.slice(-1) });
  }
  // ---- colours: any CSS colour (oklch, color(), named) is turned into RGBA by a 1×1 canvas ----
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const paint = canvas.getContext('2d', { willReadFrequently: true });
  const colourCache = new Map();
  const rgba = (value) => {
    if (colourCache.has(value)) return colourCache.get(value);
    paint.clearRect(0, 0, 1, 1); paint.fillStyle = '#000'; paint.fillStyle = value; paint.fillRect(0, 0, 1, 1);
    const d = paint.getImageData(0, 0, 1, 1).data; const c = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    colourCache.set(value, c); return c;
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const background = (e) => {
    const layers = [];
    for (let n = e; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return undefined; // text over a picture or gradient: cannot judge
      const c = rgba(cs.backgroundColor); if (c.a > 0) layers.push(c);
      if (c.a >= 1) break;
    }
    return layers.reverse().reduce((under, layer) => over(layer, under), { r: 255, g: 255, b: 255, a: 1 });
  };
  const luminance = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ownText = (e) => [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
  const group = (map, signature, e, extra) => { const g = map.get(signature); if (g) { g.count++; if (g.boxes.length < 6) g.boxes.push(box(e)); return; } map.set(signature, { count: 1, first: e, boxes: [box(e)], ...extra }); };
  const contrast = new Map(), spill = new Map(), tight = new Map();
  const sizes = new Set();
  for (const e of document.querySelectorAll('body *')) {
    const texts = ownText(e);
    if (!texts.length || !shown(e) || e.closest('[data-uxqa-overlay]')) continue;
    const cs = getComputedStyle(e);
    // Screen-reader-only text (1px boxes, clipped) is not seen by anyone.
    if (e.getBoundingClientRect().width <= 2 || cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') continue;
    const size = parseFloat(cs.fontSize);
    sizes.add(Math.round(size));
    const signature = e.tagName + '|' + (typeof e.className === 'string' ? e.className : '');
    // Contrast (WCAG AA): 4.5 for normal text, 3 for large text. Disabled controls are exempt.
    if (!e.closest('[disabled], [aria-disabled=true], :disabled')) {
      const bg = background(e);
      if (bg) {
        const fg = over(rgba(cs.color), bg);
        const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        const need = large ? 3 : 4.5;
        if (ratio < need) group(contrast, signature + '|' + cs.color, e, { detail: ratio.toFixed(1) + '|' + need });
      }
    }
    // Text that spills out of its own box (the box does not clip, so the words run over whatever is next to it).
    // Inside a box that scrolls sideways (code, wide tables) the overflow is reachable on purpose.
    const scroller = (() => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if ((o === 'auto' || o === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true; } return false; })();
    // scrollWidth confirms real overflow; trailing spaces that hang past a wrapped line do not count.
    if (cs.overflowX === 'visible' && !/^inline$|^contents$/.test(cs.display) && !scroller && e.scrollWidth > e.clientWidth + 2) {
      const r = e.getBoundingClientRect();
      for (const n of texts) {
        const range = document.createRange(); range.selectNodeContents(n);
        const t = range.getBoundingClientRect();
        if (t.width > 0 && (t.right > r.right + Math.max(3, size * 0.8) || t.left < r.left - Math.max(3, size * 0.8))) { group(spill, signature, e, { detail: String(Math.round(Math.max(t.right - r.right, r.left - t.left))) }); break; }
      }
    }
    // Paragraphs whose lines nearly touch.
    const lh = parseFloat(cs.lineHeight);
    if (!Number.isNaN(lh) && lh / size < 1.2 && size < 24 && text(e).length > 40 && lines(e) >= 2) group(tight, signature, e, { detail: (lh / size).toFixed(2) });
  }
  for (const [signature, g] of contrast) { const [ratio, need] = g.detail.split('|'); out.push({ el: g.first, kind: 'low-contrast', key: 'contrast:' + signature, label: '文字', text: text(g.first).slice(0, 16), box: g.boxes[0], boxes: g.boxes, detail: ratio + '|' + need, count: g.count }); }
  for (const [signature, g] of spill) out.push({ el: g.first, kind: 'text-overflow', key: 'spill:' + signature, label: labelOf(g.first) === '标签' ? '文字' : labelOf(g.first), text: text(g.first).slice(0, 16), box: g.boxes[0], boxes: g.boxes, detail: g.detail, count: g.count });
  for (const [signature, g] of tight) out.push({ el: g.first, kind: 'tight-lines', key: 'tight:' + signature, label: '段落', text: text(g.first).slice(0, 16), box: g.boxes[0], boxes: g.boxes, detail: g.detail, count: g.count });
  // Pictures squashed or stretched: shown aspect ratio differs from the file's.
  for (const i of document.images) {
    if (!shown(i) || !i.naturalWidth || !i.naturalHeight || getComputedStyle(i).objectFit !== 'fill') continue;
    const r = i.getBoundingClientRect(); if (r.width < 16 || r.height < 16) continue;
    const off = Math.abs((r.width / r.height) / (i.naturalWidth / i.naturalHeight) - 1);
    if (off > 0.05) out.push({ el: i, kind: 'image-stretched', key: key(i), label: '图片', text: i.alt || '', box: box(i), detail: i.naturalWidth + '×' + i.naturalHeight + '|' + Math.round(r.width) + '×' + Math.round(r.height) });
  }
  // Whole-page consistency: how many different font sizes, button heights and button corner radii one page uses.
  const page = { x: scrollX, y: scrollY, width: innerWidth, height: Math.min(innerHeight, document.documentElement.scrollHeight) };
  if (sizes.size > 8) out.push({ kind: 'many-font-sizes', key: 'page:font-sizes', label: '页面', text: '', box: page, detail: [...sizes].sort((a, b) => a - b).join('、') });
  const heights = new Map(), radii = new Map();
  for (const b of document.querySelectorAll('button, [role=button], a[class*=btn], a[class*=button]')) {
    if (!shown(b) || b.closest('[data-uxqa-overlay]')) continue;
    // Tabs, list rows and menu items are buttons in code but not "buttons" to the eye.
    if (b.matches('[role=tab], [role=option], [role=menuitem], [role=treeitem], [aria-selected], [aria-current]') || b.closest('[role=tablist], [role=listbox], [role=menu]')) continue;
    const r = b.getBoundingClientRect(); if (r.height < 16 || r.height > 80 || (r.width > 200 && r.width > r.height * 4)) continue;
    const h = Math.round(r.height); if (!heights.has(h)) heights.set(h, b);
    const radius = parseFloat(getComputedStyle(b).borderTopLeftRadius) || 0;
    const shape = radius >= r.height / 2 - 1 ? 'pill' : String(Math.round(radius));
    if (!radii.has(shape)) radii.set(shape, b);
  }
  if (heights.size > 4) out.push({ kind: 'mixed-button-height', key: 'page:button-heights', label: '按钮', text: '', box: box([...heights.values()][0]), boxes: [...heights.values()].slice(0, 6).map(box), detail: [...heights.keys()].sort((a, b) => a - b).join('、') });
  if (radii.size > 3) out.push({ kind: 'mixed-radius', key: 'page:button-radii', label: '按钮', text: '', box: box([...radii.values()][0]), boxes: [...radii.values()].slice(0, 6).map(box), detail: [...radii.keys()].map((k) => k === 'pill' ? '全圆角' : k + 'px').join('、') });
  // Class names of the element and its two nearest ancestors let the Node side confirm a source match.
  // The element's own class names, and its two nearest ancestors' (used only when the element itself has none).
  const split = (n) => (n && typeof n.className === 'string' ? n.className.split(/\\s+/).filter(Boolean) : []);
  const near = (e) => [...new Set([...split(e.parentElement), ...split(e.parentElement && e.parentElement.parentElement)])].slice(0, 40);
  return out.map(({ el, ...rest }) => (el ? { ...rest, classes: [...new Set(split(el))].slice(0, 40), near: near(el) } : rest));
}`;

const DRAW_SCRIPT = `(boxes) => {
  const layer = document.createElement('div');
  layer.setAttribute('data-uxqa-overlay', '');
  layer.setAttribute('style', 'position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;');
  for (const box of boxes) {
    const frame = document.createElement('div');
    frame.setAttribute('style', 'position:absolute!important;left:' + (box.x - 4) + 'px!important;top:' + (box.y - 4) + 'px!important;width:' + (box.width + 8) + 'px!important;height:' + (box.height + 8) + 'px!important;border:3px solid #e5484d!important;border-radius:6px!important;box-sizing:border-box!important;background:rgba(229,72,77,.06)!important;');
    layer.append(frame);
  }
  document.body.append(layer);
}`;
const REMOVE_SCRIPT = `() => { for (const layer of document.querySelectorAll('[data-uxqa-overlay]')) layer.remove(); }`;

function inPage<T>(page: Page, script: string, argument?: unknown): Promise<T> {
  return page.evaluate(`(${script})(${argument === undefined ? '' : JSON.stringify(argument)})`) as Promise<T>;
}

function widthsText(widths: number[]): string {
  const sorted = [...widths].sort((a, b) => b - a);
  const all = WIDTHS.filter((width) => width <= sorted[0]);
  if (sorted.length === all.length && sorted.length > 2) return `${sorted[0]} 宽及更窄时`;
  return `${sorted.slice(0, 3).join('、')}${sorted.length > 3 ? ' 等' : ''} 宽时`;
}

function describe(kind: VisualKind, issue: RawIssue, widths: number[]) {
  const when = widthsText(widths);
  const label = issue.label;
  const quoted = issue.text ? `「${[...issue.text].slice(0, 14).join('')}${[...issue.text].length > 14 ? '…' : ''}」` : '';
  switch (kind) {
    case 'card-density': case 'unnamed-control': case 'unlabelled-field': case 'heading-order': case 'transition-all': case 'layout-animation': case 'reduced-motion':
      return qualityDescription({ ...issue, kind });
    case 'text-wrap': return {
      name: `${quoted}${label}在 ${when}折成了两行`, what: `窗口缩到 ${when}，这个${label}里的文字换行了。`,
      consequence: '按钮、标签这类文字一换行，按钮会变高、一排高矮不齐，读起来也别扭。',
      fix: '让文字始终一行：先缩一档字号，再精简文字（例如只留关键词），再把次要按钮收起或改成图标按钮；不要把文字挤成两行。确实需要多行的复杂按钮，加 data-button-wrap="allow" 并单独验证。' };
    case 'text-clipped': return {
      name: `${quoted}${label}在 ${when}文字被截掉`, what: `窗口缩到 ${when}，这个${label}比它的文字还窄，文字被切掉了。`,
      consequence: '用户看不全上面写的是什么。', fix: '让容器至少和文字一样宽（不要固定窄宽度），空间不够时调整排列或精简文字。' };
    case 'overlap': return {
      name: `${quoted || '两块内容'}在 ${when}叠在一起`, what: `窗口缩到 ${when}，同一排的两块内容压在了一起。`,
      consequence: '文字或按钮互相遮挡，可能看不清也点不到。', fix: '空间不够时让它们换到下一行，或收起次要内容；不要靠固定宽度硬塞。' };
    case 'page-overflow': return {
      name: `页面在 ${when}要左右划`, what: `窗口缩到 ${when}，页面比屏幕宽了 ${issue.detail}px，需要左右拖动。`,
      consequence: '手机上会出现横向滚动条，内容被挤到屏幕外。', fix: '找出撑宽页面的元素，去掉固定宽度或允许它换行、缩小。' };
    case 'image-broken': return {
      name: `图片${quoted}没加载出来`, what: '这张图片地址打不开，页面上是一个空白或破图标。', consequence: '页面看起来像坏了。', fix: '检查图片地址，或者给它一个默认图。' };
    case 'size-mismatch': return {
      name: `同一排的${label}高矮不一${quoted ? `（${quoted}）` : ''}`, what: `${when}，这一排的按钮或输入框高度分别是 ${issue.detail}px。`,
      consequence: '一排控件高矮不齐，看起来没对齐。', fix: '同一排的按钮和输入框用同一个尺寸档位（例如都用组件库里的默认尺寸）。' };
    case 'misaligned': return {
      name: `同一排的${label}没对齐${quoted ? `（${quoted}）` : ''}`, what: `${when}，这一排的按钮或输入框上下错开了 ${issue.detail}px。`,
      consequence: '一排控件参差不齐，显得不规整。', fix: '让这一排垂直居中对齐（例如 items-center），并统一高度。' };
    case 'card-height': return {
      name: `同一排卡片高矮不一${quoted ? `（含${quoted}）` : ''}`, what: `${when}，同一排的卡片高度分别是 ${issue.detail}px。`,
      consequence: '一排卡片参差不齐，版面显得乱。', fix: '同一排卡片拉成一样高（例如网格默认的拉伸对齐），内容少的留白放在卡片里面。' };
    case 'tiny-text': return {
      name: `${quoted || '文字'}${(issue.count ?? 1) > 1 ? `等 ${issue.count} 处` : ''}字号只有 ${issue.detail}px`, what: `${(issue.count ?? 1) > 1 ? `这一类文字（共 ${issue.count} 处，样式相同）` : '这段文字'}只有 ${issue.detail}px，小于 11px。`, consequence: '太小的字很难看清，尤其在手机上。', fix: '最小用 11px，次要信息可以用更浅的颜色区分，而不是更小的字。' };
    case 'small-target': return {
      name: `${quoted}${(issue.count ?? 1) > 1 ? `${quoted ? '等' : ''} ${issue.count} 个`.trimStart() : ''}${quoted || (issue.count ?? 1) > 1 ? '' : '一个没有文字的'}${label}点击区只有 ${issue.detail}`, what: `${(issue.count ?? 1) > 1 ? `这一类${label}（共 ${issue.count} 个，样式相同）` : `这个${label}`}能点的范围只有 ${issue.detail} 像素，小于 24×24。`, consequence: '手指和鼠标都不容易点中，容易点错。', fix: '把可点范围扩大到至少 24×24（手机建议 44×44），图形可以不变，用内边距扩大热区。' };
    case 'low-contrast': {
      const [ratio, need] = issue.detail.split('|');
      const many = (issue.count ?? 1) > 1;
      return {
        name: `${quoted || '文字'}${many ? `等 ${issue.count} 处` : ''}颜色太淡，看不清`, what: `${many ? `这一类文字（共 ${issue.count} 处，样式相同）` : '这段文字'}和背景的对比度只有 ${ratio}，至少要 ${need}。`,
        consequence: '在阳光下、旧显示器上或视力不好的人都很难看清。', fix: '把文字颜色加深（或背景调浅），用项目里的正文 / 次要文字颜色，不要自己调更浅的灰。' };
    }
    case 'text-overflow': return {
      name: `${quoted || '文字'}${(issue.count ?? 1) > 1 ? `等 ${issue.count} 处` : ''}在 ${when}跑出了框`, what: `窗口缩到 ${when}，文字比它所在的框宽了 ${issue.detail}px，压到了框外。`,
      consequence: '文字会压到旁边的内容上，或者伸出卡片、按钮的边。', fix: '允许文字换行（去掉 whitespace-nowrap / 固定宽度），或空间不够时用省略号（truncate）并在悬停时显示全文。' };
    case 'image-stretched': {
      const [natural, shown] = issue.detail.split('|');
      return {
        name: `图片${quoted}被拉变形了`, what: `图片原本是 ${natural}，显示成了 ${shown}，宽高比例不对。`,
        consequence: '人像、Logo 会被压扁或拉长，显得很不专业。', fix: '加上 object-fit: cover（Tailwind 写 object-cover）或只固定宽度、高度设为 auto。' };
    }
    case 'tight-lines': return {
      name: `${quoted || '段落'}${(issue.count ?? 1) > 1 ? `等 ${issue.count} 处` : ''}行距太挤`, what: `这段多行文字的行高只有字号的 ${issue.detail} 倍。`,
      consequence: '上下两行几乎贴在一起，读起来很累。', fix: '正文行高用字号的 1.5 倍左右（Tailwind 用 leading-relaxed / leading-6），标题可以 1.2–1.3 倍。' };
    case 'many-font-sizes': return {
      name: `这一页用了 ${issue.detail.split('、').length} 种字号`, what: `页面上出现的字号有：${issue.detail}px。`,
      consequence: '字号太杂，页面没有层次，看起来不像一套设计。', fix: '收敛到项目统一的 5–7 档字号（例如 12、14、16、20、24、32），其他的改到最接近的一档。' };
    case 'mixed-button-height': return {
      name: `这一页的按钮有 ${issue.detail.split('、').length} 种高度`, what: `页面上按钮的高度有：${issue.detail}px。`,
      consequence: '按钮大小没有规律，同类按钮看起来不像一套。', fix: '按钮只用组件库里的几档尺寸（例如小 32 / 默认 36 / 大 40），自己写的按钮换成组件库的 Button。' };
    case 'mixed-radius': return {
      name: `这一页的按钮有 ${issue.detail.split('、').length} 种圆角`, what: `页面上按钮的圆角有：${issue.detail}。`,
      consequence: '圆角不统一，页面看起来是拼凑出来的。', fix: '按钮圆角统一用组件库的设置（例如都用 rounded-md），去掉单独写的圆角。' };
    case 'long-text': {
      const effect = { 'text-wrap': '折成了两行', 'text-clipped': '被截掉了', overlap: '和旁边的内容叠在一起', 'text-overflow': '跑出了框', 'page-overflow': '把页面撑出了左右滚动' }[issue.detail] ?? '出了问题';
      return {
        name: `${quoted}${label}在文字变长时${effect}`, what: `把这里的文字加长约 60%（模拟翻译成别的语言、或用户填了更长的内容）后，在 ${when}${effect}。`,
        consequence: '换语言或数据变长时，界面会坏掉；现在看起来正常只是因为文字刚好够短。', fix: '给文字留余量：不要用固定宽度，让按钮和标签能随文字变宽；放不下时用省略号并在悬停时显示全文，或者换行到下一排而不是挤在一起。' };
    }
    case 'dead-opener': return {
      name: `${quoted}${label}点了没有反应`, what: `这个元素标明了点击会打开${issue.detail}（带有 aria-haspopup / aria-expanded 等标记），但点了以后页面没有任何变化。`,
      consequence: '用户会以为功能坏了；用键盘和读屏软件的人也打不开。', fix: '检查点击事件有没有绑在这个元素上；如果它其实不会打开任何东西，去掉 aria-haspopup / aria-expanded 这类标记。' };
    case 'title-orphan': return {
      name: `标题${quoted}最后一行只剩一个字`, what: `${when}，标题最后一行只剩「${issue.detail}」一个字。`, consequence: '孤零零的一个字很难看。', fix: '给标题加平衡换行（text-wrap: balance），或略微调整宽度和文字。' };
  }
}

interface SourceCache { files?: string[]; content: Map<string, string> }

/**
 * Find where a visible label is written in source. Only literal JSX text (>text<) counts, only in files the page
 * actually loaded when that is known; anything ambiguous returns nothing rather than a guess.
 */
async function sourceFor(productRoot: string, text: string, loaded: string[], cache: SourceCache, classes: string[] = [], nearby: string[] = []): Promise<{ file: string; line: number } | undefined> {
  const needle = text.trim();
  if ([...needle].length < 2 || needle.includes(' / ') || needle.includes(' 和 ')) return undefined;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`>\\s*${escaped}\\s*<|>\\s*\\{\\s*["'\`]${escaped}["'\`]\\s*\\}\\s*<`, 'g');
  cache.files ??= await listProductFiles(productRoot);
  const files = cache.files;
  const knownModules = loaded.some((path) => /\.(tsx|jsx|vue|svelte)$/.test(path));
  const hits: Array<{ file: string; line: number; score: number; near: number }> = [];
  for (const file of files) {
    if (!/\.(tsx|jsx|vue|svelte|html)$/.test(file)) continue;
    const rel = toPosix(relative(productRoot, file));
    if (knownModules && !loaded.some((path) => path.endsWith(`/${rel}`))) continue;
    let content = cache.content.get(file);
    if (content === undefined) { content = await readFile(file, 'utf8').catch(() => ''); cache.content.set(file, content); }
    for (const match of content.matchAll(pattern)) {
      // The same words often appear elsewhere (a menu item, a data list). When the page element carries
      // class names, they must be written right around the text, otherwise it is not this spot.
      const around = content.slice(Math.max(0, match.index - 600), match.index + match[0].length);
      const score = classes.filter((name) => name.length > 2 && around.includes(name)).length;
      const near = nearby.filter((name) => name.length > 2 && around.includes(name)).length;
      if (classes.length ? !score : nearby.length && !near) continue;
      hits.push({ file: rel, line: content.slice(0, match.index + match[0].indexOf(needle)).split('\n').length, score, near });
    }
  }
  // Several places with the same words: answer only when one clearly matches the element's own class names best.
  // A tie on the element's own classes stays unanswered (two copies of the same close button in dialog.tsx and
  // sheet.tsx look identical; their surroundings are not reliable enough to tell them apart).
  hits.sort((a, b) => b.score - a.score || b.near - a.near);
  if (!hits[0]) return undefined;
  if (hits[1] && hits[1].score === hits[0].score && (classes.length || hits[1].near >= hits[0].near)) return undefined;
  return { file: hits[0].file, line: hits[0].line };
}

/** Component showcase pages deliberately place different sizes side by side. */
const SHOWCASE = /design-system|storybook|showcase|playground|ui-kit|kitchen-sink|components?-?(lab|gallery|demo)/i;
const CONSISTENCY: VisualKind[] = ['size-mismatch', 'misaligned', 'card-height', 'many-font-sizes', 'mixed-radius', 'mixed-button-height'];

export interface VisualTarget { baseUrl: string; routes: string[]; storageState?: string; productRoot: string }
/**
 * Where each control on the page came from, read from React's development-mode owner records (`_debugOwner`):
 * follow "who created this element" upwards until a library component (from the library) or a component the
 * project itself defines (hand-written there). Third-party internals in between are skipped. Production builds
 * and non-React pages carry no such record; those controls are counted as "unknown", never guessed.
 */
const REUSE_SCRIPT = `(input) => {
  const library = new Set(input.library), product = new Set(input.product);
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const nameOf = (f) => { if (!f) return null; const t = f.type; if (!t) return f.name || null; if (typeof t === 'string') return null; return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || null; };
  const result = { total: 0, library: 0, handwritten: 0, unknown: 0, examples: [] };
  const seen = new Set();
  for (const e of document.querySelectorAll(input.selectors.join(','))) {
    if (seen.has(e) || !shown(e) || e.closest('[data-uxqa-overlay]')) continue;
    seen.add(e);
    result.total++;
    const key = Object.keys(e).find((k) => k.startsWith('__reactFiber$'));
    let owner = key ? e[key]._debugOwner : undefined;
    let verdict = 'unknown';
    for (let depth = 0; owner && depth < 8; depth++, owner = owner._debugOwner) {
      const name = nameOf(owner);
      if (!name) continue;
      if (library.has(name)) { verdict = 'library'; break; }
      if (product.has(name)) { verdict = 'handwritten'; break; }
    }
    result[verdict]++;
    if (verdict === 'handwritten' && result.examples.length < 5) result.examples.push((e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.tagName.toLowerCase()).trim().slice(0, 16));
  }
  return result;
}`;

export interface PageReuse { route: string; total: number; library: number; handwritten: number; unknown: number; examples: string[] }

/**
 * Things that reveal more UI when clicked and say so in their markup: menu/dialog/listbox triggers (aria-haspopup),
 * collapsed sections (aria-expanded="false"), unselected tabs, <summary>. Tooltip triggers (data-state only) are not
 * included: they open on hover and often wrap a real action button. Anything that reads like an action with
 * consequences is skipped, as are submit buttons and plain links.
 */
const OPENER_SELECTOR = '[aria-haspopup]:not([aria-haspopup=false]), [aria-expanded=false], [role=tab][aria-selected=false], summary';
const RISKY = /删除|移除|清空|退出|登出|注销|提交|支付|付款|购买|下单|发送|确认|撤销|重置|禁用|停用|解绑|delete|remove|clear|logout|log out|sign out|submit|pay|buy|send|confirm|reset|disable|revoke/i;
const OPENERS_SCRIPT = `(input) => {
  const risky = new RegExp(input.risky, 'i');
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const all = [...document.querySelectorAll(input.selector)];
  const out = [];
  const seen = new Set();
  all.forEach((e, index) => {
    if (!shown(e) || e.closest('[data-uxqa-overlay]') || e.matches('[disabled], [aria-disabled=true], [type=submit], a[href]:not([href="#"]):not([role])')) return;
    const text = ((e.innerText || '').trim() || e.getAttribute('aria-label') || e.getAttribute('title') || '').replace(/\\s+/g, ' ').slice(0, 20);
    if (!text || risky.test(text)) return;
    const popup = e.getAttribute('aria-haspopup');
    const kind = e.getAttribute('role') === 'tab' ? '标签页' : e.tagName === 'SUMMARY' ? '折叠区' : popup === 'dialog' ? '弹窗' : popup === 'listbox' || e.getAttribute('role') === 'combobox' ? '下拉框' : popup ? '菜单' : '折叠区';
    if (seen.has(kind + '|' + text)) return;
    seen.add(kind + '|' + text);
    out.push({ index, text, kind });
  });
  return out.slice(0, input.limit);
}`;
/** Counts DOM changes after a click; zero means the click did nothing visible. */
const WATCH_SCRIPT = `() => { window.__uxqaChanges = 0; window.__uxqaObserver && window.__uxqaObserver.disconnect(); window.__uxqaObserver = new MutationObserver((list) => { window.__uxqaChanges += list.length; }); window.__uxqaObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); }`;
const OPENER_LIMIT = 6;

/** Makes short labels about 60% longer; a zero-width space marks where the original text ends. */
const STRETCH_SCRIPT = `() => {
  const targets = document.querySelectorAll('button, [role=button], [role=tab], [role=menuitem], a, label, th, h1, h2, h3, [class*=badge], [class*=Badge], [class*=chip], [class*=tag]:not(svg)');
  for (const e of targets) {
    if (e.closest('[data-uxqa-overlay]')) continue;
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      if (!text || text.length > 30 || n.textContent.includes('\\u200b')) continue;
      n.textContent = n.textContent.replace(text, text + '\\u200b' + text.slice(0, Math.max(2, Math.ceil(text.length * 0.6))));
    }
  }
}`;
const STRESSED: VisualKind[] = ['text-wrap', 'text-clipped', 'overlap', 'text-overflow', 'page-overflow'];

/** One screen of a checked page, kept so a vision model (or the user's own AI agent) can look at the whole page. */
export interface PageView { route: string; width: number; image: string }
export interface VisualResult { violations: Violation[]; captures: Record<string, Capture>; checkedPages: number; widths: number[]; views: PageView[]; reuse: PageReuse[] }

/** Widths at which a page screenshot is kept for review: desktop and phone-sized. */
const VIEW_WIDTHS = [1440, 390];
/** Tall pages are cut so one review image stays readable for a model. */
const VIEW_MAX_HEIGHT = 2400;

export async function auditVisual(target: VisualTarget, outDir: string, options: { progress?: (message: string) => void; signal?: AbortSignal; disabled?: Set<string>; levels?: Map<string, Violation['level']>; firstNumber?: number; reuse?: { selectors: string[]; library: string[]; product: string[] } } = {}): Promise<VisualResult> {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const found = new Map<string, { kind: VisualKind; issue: RawIssue; route: string; widths: number[]; crop?: string; modules: string[] }>();
  let browser: Browser | undefined;
  let checkedPages = 0;
  const views: PageView[] = [];
  const reuse: PageReuse[] = [];
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: WIDTHS[0], height: 900 }, ...(target.storageState ? { storageState: target.storageState } : {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    // Clicking must never change the product's data: while openers are clicked, writes are blocked (see below);
    // confirm/alert dialogs are always dismissed and new tabs closed.
    page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => undefined); });
    context.on('page', (popup) => { if (popup !== page) void popup.close().catch(() => undefined); });
    for (const route of target.routes) {
      if (options.signal?.aborted) break;
      const url = new URL(route, target.baseUrl).toString();
      options.progress?.(`正在缩放检查页面 ${route}`);
      try {
        await page.setViewportSize({ width: WIDTHS[0], height: 900 });
        const response = await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
        await page.waitForTimeout(800);
        const landed = new URL(page.url());
        if ((response && response.status() >= 400) || (landed.pathname !== new URL(url).pathname && /log-?in|sign-?in|oauth|\/auth\b|\/auth\//i.test(landed.pathname))) continue;
        checkedPages++;
        const modules = (await inPage<string[]>(page, `() => performance.getEntriesByType('resource').map((entry) => entry.name)`).catch(() => [] as string[]))
          .flatMap((name) => { try { return [decodeURIComponent(new URL(name).pathname)]; } catch { return []; } });
        if (options.reuse?.selectors.length) {
          const counted = await inPage<Omit<PageReuse, 'route'>>(page, REUSE_SCRIPT, options.reuse).catch(() => undefined);
          if (counted && counted.total) reuse.push({ route, ...counted });
        }
        const record = async (issue: RawIssue, kind: VisualKind, width: number) => {
          const rule = VISUAL_RULES[kind];
          if (options.disabled?.has(rule.id)) return;
          if (CONSISTENCY.includes(kind) && SHOWCASE.test(route)) return;
          const id = `${kind}|${route}|${issue.key}|${issue.text}`;
          const entry = found.get(id);
          if (entry) { entry.widths.push(width); return; }
          if (found.size >= 160) return;
          const crop = join(outDir, `visual-${createHash('sha256').update(id).digest('hex').slice(0, 10)}.png`);
          const boxes = issue.boxes?.length ? issue.boxes : [issue.box];
          const area = issue.box;
          const size = await inPage<{ width: number; height: number }>(page, '() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })');
          const clipWidth = Math.min(size.width, Math.max(Math.min(width, 520), Math.min(area.width, 1100) + 96));
          const clipHeight = Math.min(size.height, Math.max(220, Math.min(area.height, 700) + 96));
          const clip = { x: Math.max(0, Math.min(size.width - clipWidth, area.x + area.width / 2 - clipWidth / 2)), y: Math.max(0, Math.min(size.height - clipHeight, area.y + area.height / 2 - clipHeight / 2)), width: clipWidth, height: clipHeight };
          await inPage(page, DRAW_SCRIPT, boxes);
          const saved = await page.screenshot({ path: crop, clip, fullPage: true }).then(() => true, () => false);
          await inPage(page, REMOVE_SCRIPT);
          found.set(id, { kind, issue, route, widths: [width], ...(saved ? { crop } : {}), modules });
        };
        for (const width of WIDTHS) {
          if (options.signal?.aborted) break;
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(250);
          if (VIEW_WIDTHS.includes(width) && views.length < 40) {
            const image = join(outDir, `view-${createHash('sha256').update(`${route}|${width}`).digest('hex').slice(0, 10)}.png`);
            const height = await inPage<number>(page, '() => document.documentElement.scrollHeight').catch(() => 900);
            if (await page.screenshot({ path: image, fullPage: true, clip: { x: 0, y: 0, width, height: Math.min(height, VIEW_MAX_HEIGHT) } }).then(() => true, () => false)) views.push({ route, width, image });
          }
          const issues = await inPage<RawIssue[]>(page, VISUAL_SCRIPT).catch(() => [] as RawIssue[]);
          issues.push(...await inspectQuality(page, width === WIDTHS[0]));
          for (const issue of issues) await record(issue, issue.kind, width);
        }
        // Long-text stress: labels about 60% longer (translations, real user content), checked wide and narrow.
        if (!options.disabled?.has(VISUAL_RULES['long-text'].id) && !options.signal?.aborted) {
          await inPage(page, STRETCH_SCRIPT);
          for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 });
            await page.waitForTimeout(200);
            const issues = await inPage<RawIssue[]>(page, VISUAL_SCRIPT).catch(() => [] as RawIssue[]);
            for (const issue of issues) {
              if (!STRESSED.includes(issue.kind)) continue;
              // Only what longer text causes: the same spot already failing at normal length is not repeated.
              if ([...found.keys()].some((key) => key.startsWith(`${issue.kind}|${route}|${issue.key}|`))) continue;
              const original = { ...issue, text: issue.text.split('\u200b')[0], detail: issue.kind };
              await record(original, 'long-text', width);
            }
          }
        }
        // Click-revealed UI: open each menu, dialog, dropdown, tab or collapsed section on a fresh page and check
        // what appears. Read-only: write requests are blocked, confirm dialogs dismissed, navigation undone.
        if (!options.disabled?.has(VISUAL_RULES['dead-opener'].id) && !options.signal?.aborted) {
          await context.route('**/*', (request) => (['GET', 'HEAD', 'OPTIONS'].includes(request.request().method()) ? request.continue() : request.abort('blockedbyclient')));
          try {
          await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
          await page.waitForTimeout(400);
          await page.setViewportSize({ width: 1440, height: 900 });
          const openers = await inPage<Array<{ index: number; text: string; kind: string }>>(page, OPENERS_SCRIPT, { selector: OPENER_SELECTOR, risky: RISKY.source, limit: OPENER_LIMIT }).catch(() => []);
          for (const opener of openers) {
            if (options.signal?.aborted) break;
            const state = `点开「${opener.text}」${opener.kind}后`;
            for (const width of [1440, 390]) {
              await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
              await page.setViewportSize({ width, height: 900 });
              await page.waitForTimeout(350);
              const before = new Set((await inPage<RawIssue[]>(page, VISUAL_SCRIPT).catch(() => [] as RawIssue[])).map((issue) => `${issue.kind}|${issue.key}|${issue.text}`));
              // Find the same opener again (by kind and text) in this layout; narrow layouts may hide it.
              const here = (await inPage<Array<{ index: number; text: string; kind: string }>>(page, OPENERS_SCRIPT, { selector: OPENER_SELECTOR, risky: RISKY.source, limit: 50 }).catch(() => [])).find((entry) => entry.text === opener.text && entry.kind === opener.kind);
              if (!here) continue;
              await inPage(page, WATCH_SCRIPT);
              const clicked = await page.locator(OPENER_SELECTOR).nth(here.index).click({ timeout: 2500 }).then(() => true, () => false);
              if (!clicked) continue;
              await page.waitForTimeout(500);
              if (new URL(page.url()).pathname !== new URL(url).pathname) continue; // it navigated: not an opener after all
              const changes = await inPage<number>(page, '() => window.__uxqaChanges || 0').catch(() => 1);
              if (!changes && width === 1440) {
                const box = await page.locator(OPENER_SELECTOR).nth(here.index).boundingBox().catch(() => null);
                const scroll = await inPage<{ x: number; y: number }>(page, '() => ({ x: scrollX, y: scrollY })').catch(() => ({ x: 0, y: 0 }));
                if (box) await record({ kind: 'dead-opener', key: `opener|${opener.kind}|${opener.text}`, label: opener.kind, text: opener.text, box: { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height }, detail: opener.kind }, 'dead-opener', width);
                break;
              }
              if (width === 1440 && views.length < 40) {
                const image = join(outDir, `view-${createHash('sha256').update(`${route}|${state}|${width}`).digest('hex').slice(0, 10)}.png`);
                if (await page.screenshot({ path: image }).then(() => true, () => false)) views.push({ route: `${route} · ${state}`, width, image });
              }
              const opened = await inPage<RawIssue[]>(page, VISUAL_SCRIPT).catch(() => [] as RawIssue[]);
              for (const issue of opened) {
                if (CONSISTENCY.includes(issue.kind) || before.has(`${issue.kind}|${issue.key}|${issue.text}`)) continue;
                await record({ ...issue, state, key: `${state}|${issue.key}` }, issue.kind, width);
              }
            }
          }
          } finally {
            await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
          }
        }
      } catch { /* a page that cannot be checked is skipped; the source check is unaffected */ }
    }
  } finally {
    await browser?.close();
  }

  const violations: Violation[] = [];
  const captures: Record<string, Capture> = {};
  const cache: SourceCache = { content: new Map() };
  let number = options.firstNumber ?? 1;
  const order: VisualKind[] = ['text-wrap', 'text-clipped', 'overlap', 'page-overflow', 'image-broken', 'size-mismatch', 'misaligned', 'card-height', 'tiny-text', 'small-target', 'title-orphan'];
  const entries = [...found.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const entry of entries) {
    const rule = VISUAL_RULES[entry.kind];
    const level = options.levels?.get(rule.id) ?? rule.level;
    const described = describe(entry.kind, entry.issue, entry.widths)!;
    // Problems that only exist with a menu/dialog/tab opened say so first.
    const text = entry.issue.state ? { ...described, name: `${entry.issue.state}：${described.name}`, what: `${entry.issue.state}，${described.what}` } : described;
    const single = !['size-mismatch', 'misaligned', 'card-height', 'overlap', 'page-overflow', 'many-font-sizes', 'mixed-radius', 'mixed-button-height'].includes(entry.kind) && (entry.issue.count ?? 1) === 1;
    const source = single ? await sourceFor(target.productRoot, entry.issue.text, entry.modules, cache, entry.issue.classes, entry.issue.near) : undefined;
    const fingerprint = `${createHash('sha256').update(`${rule.id}\n${entry.route}\n${entry.issue.key}\n${entry.issue.text}`).digest('hex').slice(0, 16)}#1`;
    violations.push({
      ...text, english: englishVisualFinding(entry.kind, entry.issue, entry.widths), title: rule.title, rule: rule.id, level, origin: 'basic',
      file: source?.file ?? `页面 ${entry.route}`, line: source?.line ?? 0, column: 1,
      snippet: entry.issue.text, detail: `${rule.id}：在 ${entry.widths.join('、')} 宽时出现；页面 ${entry.route}；${entry.issue.state ? `状态：${entry.issue.state}；` : ''}元素 ${entry.issue.key}${source ? '' : '；没在源码里唯一定位到这段文字'}`,
      status: 'new', fingerprint,
    });
    const first = Math.max(...entry.widths);
    captures[fingerprint] = entry.crop
      ? { number: number++, status: 'found', shots: [{ route: entry.route, viewport: `${first} 宽`, crop: entry.crop, full: entry.crop, matches: 1 }], matches: 1, note: `截图是 ${first} 宽时${entry.issue.state ? `${entry.issue.state}` : ''}的样子，问题已圈出。${source ? '' : '没能在源码里唯一找到这段文字，所以只给页面位置。'}` }
      : { number: number++, status: 'not-found', reason: 'hidden', shots: [], matches: 0, note: '截图没有保存成功。' };
  }
  return { violations, captures, checkedPages, widths: WIDTHS, views, reuse };
}
