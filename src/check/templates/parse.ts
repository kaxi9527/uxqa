import { basename, dirname, extname } from 'node:path';

/**
 * A small, forgiving parser for Vue single-file components and Svelte components: the markup becomes an element
 * tree with file offsets; `<script>` and `<style>` blocks are kept as raw ranges. It does not evaluate anything:
 * dynamic attributes (`:class`, `class:x`, `{...props}`) are recorded as such, so callers can skip what they cannot read.
 */
export type Framework = 'vue' | 'svelte';

export interface TemplateAttribute {
  /** As written: `class`, `:class`, `@click.stop`, `on:click|once`, `class:active`, `{...rest}`. */
  raw: string;
  /** Normalised name: `class` for `:class`, `click` for events, `active` for `class:active`. */
  name: string;
  kind: 'static' | 'bound' | 'event' | 'spread' | 'directive' | 'class-directive' | 'style-directive';
  /** Value as written, without quotes; for Svelte `{expr}` the expression without braces. */
  value?: string;
  /** File offset of the first character of `value`. */
  valueStart?: number;
  /** A static Svelte value with `{expr}` parts, e.g. `class="card {extra}"`. */
  mixed?: boolean;
  /** Svelte `name={expr}`: the value is an expression. */
  braced?: boolean;
  start: number;
}

export interface TemplateText { type: 'text'; text: string; start: number; end: number }
/** `{{ x }}` (Vue), `{x}` / `{@html x}` / `{@render x()}` (Svelte). */
export interface TemplateExpression { type: 'expression'; code: string; start: number; end: number }
export interface TemplateElement {
  type: 'element';
  tag: string;
  attributes: TemplateAttribute[];
  children: TemplateChild[];
  parent?: TemplateElement;
  /** Offset of `<`, offset after `>` of the start tag, offset after the end tag (or start tag when there is none). */
  start: number;
  openEnd: number;
  end: number;
  selfClosing: boolean;
  /** Svelte `{#if}` / `{#each}` blocks directly inside: what is shown depends on data. */
  blocks?: boolean;
  /** Raw-text blocks (`<script>`, `<style>`, Vue custom blocks): the content range. */
  content?: { start: number; end: number };
}
export type TemplateChild = TemplateElement | TemplateText | TemplateExpression;

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

/** Index of the `}` closing the `{` at `open`, skipping strings, template literals and nested braces. */
export function closingBrace(text: string, open: number, limit = text.length): number {
  let depth = 0;
  for (let index = open; index < limit; index++) {
    const char = text[index];
    if (char === '"' || char === "'" || char === '`') {
      for (index++; index < limit && text[index] !== char; index++) if (text[index] === '\\') index++;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

function classify(raw: string, framework: Framework, hasValue: boolean): Pick<TemplateAttribute, 'name' | 'kind'> {
  if (framework === 'vue') {
    if (raw === 'v-bind') return { name: '', kind: 'spread' };
    if (raw === 'v-on') return { name: '', kind: 'spread' };
    if (raw.startsWith(':') || raw.startsWith('v-bind:')) return { name: raw.replace(/^(v-bind)?:/, '').split('.')[0], kind: 'bound' };
    if (raw.startsWith('@') || raw.startsWith('v-on:')) return { name: raw.replace(/^(@|v-on:)/, '').split('.')[0], kind: 'event' };
    if (raw.startsWith('v-') || raw.startsWith('#')) return { name: raw, kind: 'directive' };
    return { name: raw, kind: 'static' };
  }
  const directive = raw.match(/^([a-z]+):([^|]+)/);
  if (directive) {
    const [, prefix, name] = directive;
    if (prefix === 'on') return { name, kind: 'event' };
    if (prefix === 'class') return { name, kind: 'class-directive' };
    if (prefix === 'style') return { name, kind: 'style-directive' };
    if (prefix === 'bind') return { name, kind: 'bound' };
    return { name: raw, kind: 'directive' };
  }
  // Svelte 5 event attributes: onclick={...}
  if (/^on[a-z]+$/.test(raw) && hasValue) return { name: raw.slice(2), kind: 'event' };
  return { name: raw, kind: 'static' };
}

function decode(text: string): string {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/**
 * Parse a whole `.vue` / `.svelte` file. Top level `<script>` and `<style>` (and, in Vue, every top-level block
 * except an HTML `<template>`) are raw ranges; everything else is markup.
 */
export function parseComponentFile(text: string, framework: Framework): TemplateElement {
  const root: TemplateElement = { type: 'element', tag: '#root', attributes: [], children: [], start: 0, openEnd: 0, end: text.length, selfClosing: false };
  const stack: TemplateElement[] = [root];
  const top = () => stack[stack.length - 1];
  let index = 0;
  let textStart = -1;
  const flushText = (end: number) => {
    if (textStart < 0) return;
    const raw = text.slice(textStart, end);
    if (raw.length) top().children.push({ type: 'text', text: decode(raw), start: textStart, end });
    textStart = -1;
  };
  const length = text.length;

  while (index < length) {
    const char = text[index];
    if (char === '<') {
      if (text.startsWith('<!--', index)) {
        flushText(index);
        const close = text.indexOf('-->', index + 4);
        index = close < 0 ? length : close + 3;
        continue;
      }
      const closing = /^<\/([A-Za-z][\w.:-]*)\s*>/.exec(text.slice(index, index + 200));
      if (closing) {
        flushText(index);
        const tag = closing[1];
        const position = stack.map((element) => element.tag).lastIndexOf(tag);
        if (position > 0) {
          for (let depth = stack.length - 1; depth >= position; depth--) stack[depth].end = depth === position ? index + closing[0].length : index;
          stack.length = position;
        }
        index += closing[0].length;
        continue;
      }
      const opening = /^<([A-Za-z][\w.:-]*)/.exec(text.slice(index, index + 200));
      if (!opening) { if (textStart < 0) textStart = index; index++; continue; }
      flushText(index);
      const element: TemplateElement = { type: 'element', tag: opening[1], attributes: [], children: [], parent: top(), start: index, openEnd: index, end: index, selfClosing: false };
      let cursor = index + opening[0].length;
      // Attributes.
      for (;;) {
        while (cursor < length && /\s/.test(text[cursor])) cursor++;
        if (cursor >= length) break;
        if (text.startsWith('/>', cursor)) { element.selfClosing = true; cursor += 2; break; }
        if (text[cursor] === '>') { cursor++; break; }
        if (framework === 'svelte' && text[cursor] === '{') {
          const close = closingBrace(text, cursor);
          if (close < 0) { cursor = length; break; }
          const code = text.slice(cursor + 1, close).trim();
          element.attributes.push(code.startsWith('...')
            ? { raw: `{${code}}`, name: '', kind: 'spread', value: code.slice(3), valueStart: cursor + 1, start: cursor }
            : { raw: `{${code}}`, name: code, kind: 'bound', value: code, valueStart: cursor + 1, start: cursor });
          cursor = close + 1;
          continue;
        }
        const nameStart = cursor;
        while (cursor < length && !/[\s=>]/.test(text[cursor]) && !text.startsWith('/>', cursor)) cursor++;
        const raw = text.slice(nameStart, cursor);
        if (!raw) { cursor++; continue; }
        let value: string | undefined;
        let valueStart: number | undefined;
        let braced = false;
        let mixed = false;
        let probe = cursor;
        while (probe < length && /\s/.test(text[probe])) probe++;
        if (text[probe] === '=') {
          probe++;
          while (probe < length && /\s/.test(text[probe])) probe++;
          const quote = text[probe];
          if (quote === '"' || quote === "'") {
            valueStart = probe + 1;
            let end = valueStart;
            while (end < length && text[end] !== quote) {
              if (framework === 'svelte' && text[end] === '{') {
                const close = closingBrace(text, end);
                if (close < 0) break;
                mixed = true;
                end = close + 1;
                continue;
              }
              end++;
            }
            value = text.slice(valueStart, end);
            cursor = end + 1;
            // `attr="{expr}"` is the same as `attr={expr}`.
            if (framework === 'svelte' && mixed && /^\{[\s\S]*\}$/.test(value) && closingBrace(value, 0) === value.length - 1) {
              value = value.slice(1, -1); valueStart++; braced = true; mixed = false;
            }
          } else if (framework === 'svelte' && quote === '{') {
            const close = closingBrace(text, probe);
            valueStart = probe + 1;
            value = text.slice(valueStart, close < 0 ? length : close);
            cursor = close < 0 ? length : close + 1;
            braced = true;
          } else {
            valueStart = probe;
            let end = probe;
            while (end < length && !/[\s>]/.test(text[end]) && !text.startsWith('/>', end)) end++;
            value = text.slice(valueStart, end);
            cursor = end;
          }
        }
        const kind = classify(raw, framework, value !== undefined);
        const attribute: TemplateAttribute = { raw, ...kind, start: nameStart, ...(value !== undefined ? { value, valueStart } : {}), ...(mixed ? { mixed } : {}), ...(braced ? { braced } : {}) };
        // Svelte `attr={expr}` is a bound value even without a directive.
        if (framework === 'svelte' && braced && attribute.kind === 'static') attribute.kind = 'bound';
        element.attributes.push(attribute);
      }
      element.openEnd = cursor;
      element.end = cursor;
      top().children.push(element);
      index = cursor;
      const lang = element.attributes.find((attribute) => attribute.name === 'lang')?.value;
      const rawBlock = stack.length === 1 && (element.tag === 'script' || element.tag === 'style' || (framework === 'vue' && (element.tag !== 'template' || (lang !== undefined && lang !== 'html'))));
      if (element.selfClosing || VOID.has(element.tag.toLowerCase())) continue;
      if (rawBlock || element.tag === 'script' || element.tag === 'style') {
        const close = text.indexOf(`</${element.tag}`, cursor);
        const end = close < 0 ? length : close;
        element.content = { start: cursor, end };
        const after = close < 0 ? length : text.indexOf('>', close);
        element.end = after < 0 ? length : after + 1;
        index = element.end;
        continue;
      }
      stack.push(element);
      continue;
    }
    if (framework === 'vue' && text.startsWith('{{', index) && stack.length > 1) {
      flushText(index);
      const close = text.indexOf('}}', index + 2);
      const end = close < 0 ? length : close + 2;
      top().children.push({ type: 'expression', code: text.slice(index + 2, close < 0 ? length : close).trim(), start: index, end });
      index = end;
      continue;
    }
    if (framework === 'svelte' && char === '{') {
      flushText(index);
      const close = closingBrace(text, index);
      const end = close < 0 ? length : close + 1;
      const code = text.slice(index + 1, close < 0 ? length : close).trim();
      if (/^[#:/]/.test(code)) top().blocks = true;
      else if (!/^@(const|debug)\b/.test(code)) top().children.push({ type: 'expression', code, start: index, end });
      index = end;
      continue;
    }
    if (textStart < 0) textStart = index;
    index++;
  }
  flushText(length);
  for (let depth = stack.length - 1; depth > 0; depth--) stack[depth].end = length;
  return root;
}

/** Same length as `text`, with everything outside `ranges` blanked (newlines kept), so offsets and lines stay exact. */
export function maskOutside(text: string, ranges: Array<{ start: number; end: number }>): string {
  const keep = new Uint8Array(text.length);
  for (const range of ranges) keep.fill(1, range.start, range.end);
  let out = '';
  for (let index = 0; index < text.length; index++) out += keep[index] || text[index] === '\n' ? text[index] : ' ';
  return out;
}

/** Top-level blocks of a component file: scripts (with language) and styles (with language). */
export function componentBlocks(root: TemplateElement): { scripts: Array<{ start: number; end: number; lang: string }>; styles: Array<{ start: number; end: number; lang: string }> } {
  const blocks = { scripts: [] as Array<{ start: number; end: number; lang: string }>, styles: [] as Array<{ start: number; end: number; lang: string }> };
  for (const child of root.children) {
    if (child.type !== 'element' || !child.content) continue;
    const lang = child.attributes.find((attribute) => attribute.name === 'lang')?.value ?? child.attributes.find((attribute) => attribute.name === 'type')?.value?.replace(/^text\/(typescript)?.*$/, (_, typescript) => (typescript ? 'ts' : 'js')) ?? '';
    if (child.tag === 'script') blocks.scripts.push({ ...child.content, lang: lang || 'js' });
    if (child.tag === 'style') blocks.styles.push({ ...child.content, lang: lang || 'css' });
  }
  return blocks;
}

/** Markup nodes: for Vue the children of the top-level HTML `<template>`, for Svelte everything outside script/style. */
export function markupOf(root: TemplateElement, framework: Framework): TemplateChild[] {
  if (framework === 'vue') {
    return root.children.flatMap((child) => (child.type === 'element' && child.tag === 'template' && !child.content ? child.children : []));
  }
  return root.children.filter((child) => !(child.type === 'element' && child.content));
}

/** `<my-button>` → `MyButton`; `<Foo.Bar>` stays. */
export function pascalTag(tag: string): string {
  return tag.includes('-') ? tag.split('-').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('') : tag;
}

/** The component a `.vue` / `.svelte` file defines is named after the file (`order-card.vue` → `OrderCard`, `Button/index.vue` → `Button`). */
export function componentNameFromFile(file: string): string | undefined {
  let stem = basename(file, extname(file));
  if (stem === 'index') stem = basename(dirname(file));
  const name = stem.split(/[-_.\s]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('');
  return /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : undefined;
}
