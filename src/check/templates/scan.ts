import ts from 'typescript';
import type { Observation } from '../scan.js';
import { wideWidth } from '../hints.js';
import { ARBITRARY, camelCase, COLOR_IN_TEXT, COLOR_VALUE, meaningful, SIZE_VALUE, STYLE_COLOR_KEYS, STYLE_SIZE_KEYS, stylePrefix, toPx, trimSnippet } from '../values.js';
import { expressionsOf, viewOf, type ElementView } from './element.js';
import { templateHints } from './hints.js';
import { componentBlocks, componentNameFromFile, markupOf, maskOutside, parseComponentFile, type Framework, type TemplateAttribute, type TemplateChild, type TemplateElement } from './parse.js';

export interface BlockScanners {
  /** Scan the file's scripts (everything else blanked out) with the JSX/TS scanner. */
  script(lang: 'ts' | 'tsx' | 'js' | 'jsx', masked: string): Observation[];
  /** Scan the file's styles (everything else blanked out) with the CSS scanner. */
  style(lang: string, masked: string): Observation[];
}

const PATTERN_MAX_DEPTH = 5;
const PATTERN_MAX_NODES = 40;

function lineIndex(text: string) {
  const starts = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') starts.push(index + 1);
  const lineOf = (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle; else high = middle - 1;
    }
    return low;
  };
  return { starts, lineOf };
}

interface Shape { exact: string; loose: string; size: number; classes: string[] }

/** Element children with `<template>` / `<svelte:fragment>` wrappers looked through; slots and skipped tags are left out. */
function elementChildren(element: TemplateElement, framework: Framework): ElementView[] {
  const result: ElementView[] = [];
  for (const child of element.children) {
    if (child.type !== 'element') continue;
    const view = viewOf(child, framework);
    if (view.role === 'transparent') result.push(...elementChildren(child, framework));
    else if (view.role !== 'skip') result.push(view);
  }
  return result;
}

/** Structure fingerprint, the same as the JSX one: tags, roles, input types and static classes; text and values are ignored. */
function shapeOf(view: ElementView, framework: Framework, depth = 0, budget = { nodes: 0 }): Shape | undefined {
  if (depth > PATTERN_MAX_DEPTH || budget.nodes >= PATTERN_MAX_NODES) return undefined;
  budget.nodes++;
  const role = view.literal('role');
  const type = view.literal('type');
  const head = `${view.tag}${role ? `[role=${role}]` : ''}${type ? `[type=${type}]` : ''}`;
  const children: Shape[] = [];
  for (const child of elementChildren(view.element, framework)) {
    const shape = shapeOf(child, framework, depth + 1, budget);
    if (shape) children.push(shape);
  }
  return {
    exact: `${head}{${view.classes.join(' ')}}${children.length ? `(${children.map((child) => child.exact).join(',')})` : ''}`,
    loose: `${head}${children.length ? `(${children.map((child) => child.loose).join(',')})` : ''}`,
    size: 1 + children.reduce((sum, child) => sum + child.size, 0),
    classes: [...new Set([...view.classes, ...children.flatMap((child) => child.classes)])],
  };
}

function firstText(children: TemplateChild[], blocks = false): string | undefined {
  for (const child of children) {
    if (child.type === 'text' && !blocks) {
      const text = child.text.replace(/\s+/g, ' ').trim();
      if (meaningful(text)) return text;
    }
    if (child.type === 'element' && !child.content) {
      const found = firstText(child.children, !!child.blocks);
      if (found) return found;
    }
  }
  return undefined;
}

/** String literals inside an expression (`:class="['a', ok && 'b-[#fff]']"`), with the offset of their first character. */
function stringLiterals(code: string, offset: number): Array<{ text: string; offset: number }> {
  const found: Array<{ text: string; offset: number }> = [];
  for (const match of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    if (match[1] === '`' && match[2].includes('${')) continue;
    found.push({ text: match[2], offset: offset + (match.index ?? 0) + 1 });
  }
  return found;
}

export function scanComponentFile(rel: string, text: string, framework: Framework, scanners: BlockScanners): Observation[] {
  const root = parseComponentFile(text, framework);
  const { scripts, styles } = componentBlocks(root);
  const { starts, lineOf } = lineIndex(text);
  const at = (offset: number) => {
    const line = lineOf(offset);
    const end = starts[line + 1] !== undefined ? starts[line + 1] - 1 : text.length;
    return { file: rel, line: line + 1, column: offset - starts[line] + 1, snippet: trimSnippet(text.slice(starts[line], end)) };
  };
  const observations: Observation[] = [];

  // Scripts and styles keep their exact positions: everything else in the file is blanked out before scanning.
  if (scripts.length) {
    const langs = new Set(scripts.map((script) => script.lang));
    const lang = langs.has('tsx') ? 'tsx' : langs.has('ts') && langs.has('jsx') ? 'tsx' : langs.has('ts') ? 'ts' : langs.has('jsx') ? 'jsx' : 'js';
    observations.push(...scanners.script(lang, maskOutside(text, scripts)).filter((observation) => observation.kind !== 'definition' && observation.kind !== 'pattern'));
  }
  const styleLangs = new Map<string, Array<{ start: number; end: number }>>();
  for (const style of styles) {
    // Indented syntaxes (Sass, Stylus) have no braces; reading them as CSS would be wrong.
    if (!['css', 'scss', 'less', 'postcss', 'pcss'].includes(style.lang)) continue;
    const lang = ['postcss', 'pcss'].includes(style.lang) ? 'css' : style.lang;
    styleLangs.set(lang, [...(styleLangs.get(lang) ?? []), style]);
  }
  for (const [lang, ranges] of styleLangs) observations.push(...scanners.style(lang, maskOutside(text, ranges)));

  const name = componentNameFromFile(rel);
  const first = root.children.find((child): child is TemplateElement => child.type === 'element');
  if (name && first) observations.push({ kind: 'definition', name, ...at(first.start) });

  const markup = markupOf(root, framework);
  const ancestors: ElementView[] = [];
  const insideScroller = () => ancestors.some((view) => view.classes.some((name) => /^overflow-(x-)?(auto|scroll)$/.test(name)));

  const scanClassTokens = (view: ElementView, tokens: Array<{ token: string; offset: number }>) => {
    const siblings = tokens.map((entry) => entry.token);
    const tag = view.role === 'intrinsic' ? view.tag : undefined;
    const owner = view.text && meaningful(view.text) ? { text: view.text } : {};
    for (const { token, offset } of tokens) {
      for (const match of token.matchAll(ARBITRARY)) {
        const [, , prefix, raw] = match;
        const position = at(offset + (match.index ?? 0));
        if (COLOR_VALUE.test(raw)) observations.push({ kind: 'color', value: raw, context: 'class', token: match[0], classes: siblings, ...(tag ? { tag } : {}), ...owner, ...position });
        const size = raw.match(SIZE_VALUE);
        if (size && wideWidth(prefix, toPx(Math.abs(Number(size[1])), size[2])) && tag !== 'table' && !siblings.some((entry) => /^overflow-(x-)?(auto|scroll)$/.test(entry)) && !insideScroller()) observations.push({ kind: 'hint', check: 'wide-fixed-width', detail: raw, classes: siblings, ...(tag ? { tag } : {}), ...owner, ...position });
        if (size && Number(size[1]) !== 0) observations.push({ kind: 'size', raw: match[0].replace(/^(?:[a-z0-9-]+:)*/, ''), px: toPx(Math.abs(Number(size[1])), size[2]), prefix, context: 'class', token: match[0], classes: siblings, ...(tag ? { tag } : {}), ...owner, ...position });
      }
    }
  };

  const tokensIn = (value: string, offset: number) => [...value.matchAll(/\S+/g)].map((match) => ({ token: match[0], offset: offset + (match.index ?? 0) }));

  /** One `property: value` from an inline style; `offset` is where the value starts. */
  const styleDeclaration = (property: string, value: string | number, offset: number, numeric: boolean) => {
    const key = camelCase(property.replace(/^['"]|['"]$/g, ''));
    const textValue = String(value).trim();
    const number = numeric ? Number(value) : parseFloat(textValue);
    const position = at(offset);
    if (key === 'zIndex' && number >= 1000) observations.push({ kind: 'hint', check: 'huge-z-index', detail: String(number), ...position });
    if ((key === 'width' || key === 'minWidth') && number >= 480 && !numeric && /^\d+(\.\d+)?px$/.test(textValue)) observations.push({ kind: 'hint', check: 'wide-fixed-width', detail: `${number}px`, ...position });
    if (STYLE_COLOR_KEYS.has(key) && !numeric && COLOR_IN_TEXT.test(textValue)) observations.push({ kind: 'color', value: textValue.match(COLOR_IN_TEXT)![0], context: 'style', ...position });
    if (STYLE_SIZE_KEYS.test(key) && !numeric) {
      const size = textValue.match(SIZE_VALUE);
      const prefix = stylePrefix(key);
      if (size && Number(size[1]) !== 0) observations.push({ kind: 'size', raw: `${property}: ${textValue}`, px: toPx(Math.abs(Number(size[1])), size[2]), ...(prefix ? { prefix } : {}), context: 'style', ...position });
    }
  };

  const scanStyleAttribute = (attribute: TemplateAttribute) => {
    if (attribute.value === undefined || attribute.valueStart === undefined) return;
    if (attribute.kind === 'static') {
      // Svelte `{expr}` parts are blanked so a declaration never spans one.
      let value = attribute.value;
      for (const expression of expressionsOf(attribute)) {
        const start = expression.offset - attribute.valueStart - 1;
        value = value.slice(0, start) + '\u0000'.repeat(expression.code.length + 2) + value.slice(start + expression.code.length + 2);
      }
      for (const match of value.matchAll(/([a-zA-Z-]+)\s*:\s*([^;]+)/g)) {
        if (match[2].includes('\u0000')) continue;
        const valueOffset = (match.index ?? 0) + match[0].indexOf(match[2], match[1].length);
        styleDeclaration(match[1], match[2], attribute.valueStart + valueOffset, false);
      }
      return;
    }
    if (attribute.kind !== 'bound' || framework !== 'vue') return;
    // Vue `:style="{ color: '#fff' }"`: only an object literal with written-out values is read.
    const source = ts.createSourceFile('style.ts', `(${attribute.value})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const statement = source.statements[0];
    if (!statement || !ts.isExpressionStatement(statement) || !ts.isParenthesizedExpression(statement.expression) || !ts.isObjectLiteralExpression(statement.expression.expression)) return;
    for (const property of statement.expression.expression.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
      const value = property.initializer;
      if (!key) continue;
      const offset = attribute.valueStart + value.getStart(source) - 1;
      // Vue does not add "px" to numbers, so only zIndex reads a bare number.
      if (ts.isNumericLiteral(value)) { if (camelCase(key) === 'zIndex') styleDeclaration(key, Number(value.text), offset, true); continue; }
      if (ts.isStringLiteralLike(value)) styleDeclaration(key, value.text, offset + 1, false);
    }
  };

  // In Vue, the root element(s) of the template receive the attributes the parent passes.
  const visit = (children: TemplateChild[], rootLevel: boolean) => {
    for (const child of children) {
      if (child.type !== 'element' || child.content) continue;
      const view = viewOf(child, framework, rootLevel);
      if (view.role === 'skip' && /^(svelte:head|svelte:options|svelte:window|svelte:document|svelte:body)$/.test(child.tag)) continue;
      if (view.role === 'intrinsic' || view.role === 'component') {
        const position = at(child.start);
        if (view.role === 'intrinsic') {
          // A role or input type bound to data could make this anything; it is not guessed.
          const unknown = view.dynamic('role') || (view.tag === 'input' && view.dynamic('type'));
          const role = view.literal('role');
          const inputType = view.literal('type');
          if (!unknown) observations.push({ kind: 'intrinsic', tag: view.tag, ...(role ? { role } : {}), ...(view.tag === 'input' && inputType ? { inputType } : {}), ...(view.text ? { text: view.text } : {}), classes: view.classes, ...position });
        } else {
          observations.push({ kind: 'usage', component: view.tag.split('.').pop()!, props: view.names, ...(view.text ? { text: view.text } : {}), ...position });
        }
        for (const hint of templateHints(view, framework)) observations.push({ kind: 'hint', ...hint, ...position });

        scanClassTokens(view, view.classTokens);
        for (const attribute of child.attributes) {
          if (attribute.name === 'class' && (attribute.kind === 'bound' || attribute.mixed)) {
            for (const expression of expressionsOf(attribute)) for (const literal of stringLiterals(expression.code, expression.offset)) scanClassTokens(view, tokensIn(literal.text, literal.offset));
          }
          // `class:bg-[#fff]={on}` names a class literally.
          if (attribute.kind === 'class-directive') scanClassTokens(view, [{ token: attribute.name, offset: attribute.start + 'class:'.length }]);
          if (attribute.name === 'style' && (attribute.kind === 'static' || attribute.kind === 'bound')) scanStyleAttribute(attribute);
          if (attribute.kind === 'style-directive' && attribute.value !== undefined && attribute.valueStart !== undefined && !attribute.mixed) {
            // `style:color="#fff"` or `style:color={"#fff"}`; anything computed is not read.
            const quoted = attribute.braced ? attribute.value.trim().match(/^(['"])([^'"{}]*)\1$/) : undefined;
            const value = attribute.raw.includes('|') ? undefined : attribute.braced ? quoted?.[2] : attribute.value;
            const offset = attribute.valueStart + (quoted ? attribute.value.indexOf(quoted[0]) + 1 : 0);
            if (value !== undefined && !/[{}]/.test(value)) styleDeclaration(attribute.name, value, offset, false);
          }
        }

        // Repeated markup that is not a component yet.
        const shape = shapeOf(view, framework);
        if (shape && shape.size >= 3 && shape.classes.length >= 3) {
          const label = firstText(child.children);
          observations.push({ kind: 'pattern', ...shape, rootTag: view.tag, rootClasses: view.classes, ...(label ? { text: label } : {}), endLine: lineOf(Math.max(child.start, child.end - 1)) + 1, start: child.start, end: child.end, ...position });
        }
      }
      ancestors.push(view);
      visit(child.children, rootLevel && view.role === 'transparent');
      ancestors.pop();
    }
  };
  visit(markup, framework === 'vue');
  return observations;
}
