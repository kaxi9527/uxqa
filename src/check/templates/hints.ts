import { BUTTONISH, classHints, ICONISH, NAMED_BY, type Hint } from '../hints.js';
import { classifyTag, type ElementView } from './element.js';
import type { Framework, TemplateElement } from './parse.js';

/** Children are only icons (self-closing or empty icon elements, `<svg>`), no text, no `{{ }}` / `{}` and no blocks. */
function onlyIcons(element: TemplateElement, framework: Framework): boolean {
  if (element.blocks || element.selfClosing) return false;
  if (element.attributes.some((attribute) => /^v-(html|text)$/.test(attribute.name))) return false;
  let icons = 0;
  for (const child of element.children) {
    if (child.type === 'text') { if (child.text.trim()) return false; continue; }
    if (child.type === 'expression') return false;
    const { tag } = classifyTag(child.tag, framework);
    if (child.tag === 'svg') { icons++; continue; }
    const empty = child.selfClosing || child.children.every((inner) => inner.type === 'text' && !inner.text.trim());
    if (ICONISH.test(tag) && empty && !child.blocks) { icons++; continue; }
    return false;
  }
  return icons > 0;
}

function inside(element: TemplateElement, framework: Framework, test: (tag: string) => boolean): boolean {
  for (let current = element.parent; current && current.tag !== '#root'; current = current.parent) {
    if (test(classifyTag(current.tag, framework).tag)) return true;
  }
  return false;
}

/** The same checks as `jsxHints`, read from a Vue / Svelte element. Checks that need the full class list are skipped when part of it is bound to data. */
export function templateHints(view: ElementView, framework: Framework): Hint[] {
  const { tag, has, literal, dynamic, spread, classes, classesComplete, text } = view;
  const intrinsic = view.role === 'intrinsic';
  const named = NAMED_BY.some(has) || (!intrinsic && view.names.some((name) => /label|title|tooltip|^text$|^name$|srText/i.test(name)));
  const hints: Hint[] = [];
  const base = { tag, ...(text ? { text } : {}), classes };

  if (tag === 'img' && !has('alt') && !spread) hints.push({ check: 'img-alt', ...base });
  if (tag === 'img' && !spread && classesComplete && !(has('width') && has('height')) && !classes.some((name) => /^(w|h|size|aspect)-/.test(name.replace(/^[a-z]+:/, '')))) hints.push({ check: 'img-size', ...base });
  if ((BUTTONISH.test(tag) || tag === 'a') && !named && !spread && onlyIcons(view.element, framework)) hints.push({ check: 'icon-button-name', ...base });
  if (intrinsic && ['div', 'span', 'li', 'p', 'img', 'td', 'tr', 'section', 'article'].includes(tag) && view.event('click') && !spread && !dynamic('role')) {
    const role = literal('role');
    if (!role || !['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'switch', 'radio', 'presentation', 'none'].includes(role)) hints.push({ check: 'click-without-button', ...base });
  }
  if (tag === 'a' && !spread) {
    const href = literal('href');
    if (!has('href')) hints.push({ check: 'link-href', ...base });
    else if (href !== undefined && (href === '#' || href === '' || /^javascript:/i.test(href))) hints.push({ check: 'link-href', ...base, detail: href || '空字符串' });
  }
  if (literal('target') === '_blank' && !spread) {
    const rel = literal('rel');
    if (!has('rel') || (rel !== undefined && !/noopener|noreferrer/.test(rel))) hints.push({ check: 'blank-rel', ...base });
  }
  const tabIndex = Number(literal('tabindex'));
  if (tabIndex > 0) hints.push({ check: 'positive-tabindex', ...base, detail: String(tabIndex) });
  if (has('autofocus')) hints.push({ check: 'autofocus', ...base });
  if (intrinsic && ['input', 'select', 'textarea'].includes(tag) && !spread && !named && !has('id') && !dynamic('type') && classesComplete) {
    const type = literal('type');
    if (!['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type ?? '') && !classes.includes('hidden') && !classes.includes('sr-only') && !inside(view.element, framework, (name) => /^label$|Label$/.test(name))) {
      const placeholder = literal('placeholder');
      hints.push({ check: 'input-label', ...base, ...(placeholder ? { detail: placeholder } : {}) });
    }
  }
  if (tag === 'button' && !has('type') && !spread && inside(view.element, framework, (name) => name === 'form')) hints.push({ check: 'form-button-type', ...base });
  if (tag === 'iframe' && !has('title') && !spread) hints.push({ check: 'iframe-title', ...base });
  const role = literal('role') ?? '';
  const focusable = (intrinsic && ['button', 'a', 'summary', 'select'].includes(tag)) || (intrinsic && tag === 'input' && ['checkbox', 'radio', 'submit', 'button', 'range'].includes(literal('type') ?? ''))
    || has('tabindex') || (!intrinsic && /Button|Link|Trigger|Tab$|Tabs?Trigger|Checkbox|Switch|Radio|Toggle/.test(tag)) || ['button', 'link', 'tab', 'checkbox', 'switch'].includes(role);
  hints.push(...classHints(classes, text).filter((hint) => hint.check !== 'outline-none' || (focusable && classesComplete)));
  return hints;
}
