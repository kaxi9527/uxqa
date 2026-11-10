import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';
import { parseSource, toPosix } from '../inventory/read.js';
import { cssHints, htmlHints, jsxHints, wideWidth, type HintCheck } from './hints.js';
import { scanComponentFile } from './templates/scan.js';
import { ARBITRARY, COLOR_IN_TEXT, COLOR_VALUE, SIZE_VALUE, STYLE_COLOR_KEYS, STYLE_SIZE_KEYS, meaningful, stylePrefix, toPx, trimSnippet } from './values.js';

export interface Position { file: string; line: number; column: number; snippet: string }

export type Observation =
  | (Position & { kind: 'intrinsic'; tag: string; role?: string; inputType?: string; text?: string; classes: string[] })
  /** `token` is the full class name as written (e.g. `md:bg-[#123]`), used to find the element on a rendered page. */
  | (Position & { kind: 'color'; value: string; context: 'class' | 'style' | 'css'; token?: string; classes?: string[]; tag?: string; text?: string })
  | (Position & { kind: 'size'; raw: string; px: number; prefix?: string; context: 'class' | 'style'; token?: string; classes?: string[]; tag?: string; text?: string })
  | (Position & { kind: 'definition'; name: string })
  | (Position & { kind: 'import'; module: string })
  | (Position & { kind: 'usage'; component: string; props: string[]; text?: string })
  | (Position & { kind: 'hint'; check: HintCheck; tag?: string; text?: string; detail?: string; classes?: string[] })
  | (Position & { kind: 'pattern'; exact: string; loose: string; size: number; classes: string[]; rootTag: string; rootClasses: string[]; text?: string; endLine: number; start: number; end: number });

export interface IgnoreMark { rules: string[]; reason?: string }

export interface ScannedFile {
  file: string;
  observations: Observation[];
  /** 1-based line → ignore mark covering that line. */
  ignores: Map<number, IgnoreMark>;
  parseError?: string;
}

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'artifacts', 'vendor', '.git', '.next', '.nuxt', '.cache', 'out', 'storybook-static']);
const SCRIPT_EXT = new Set(['.tsx', '.jsx', '.ts', '.js']);
/** Vue single-file components and Svelte components: markup, scripts and styles in one file. */
const COMPONENT_EXT = new Set(['.vue', '.svelte']);
const STYLE_EXT = new Set(['.css']);
export const MAX_FILES = 3000;
const MAX_BYTES = 512_000;

export function isScannable(file: string): boolean {
  const ext = extname(file);
  // index.html (and SvelteKit's src/app.html) is read only for page-wide settings (zoom, language).
  if (/(^|[\\/])index\.html$/.test(file) || /(^|[\\/])src[\\/]app\.html$/.test(file)) return true;
  return (SCRIPT_EXT.has(ext) || STYLE_EXT.has(ext) || COMPONENT_EXT.has(ext)) && !/\.(test|spec|stories|d)\.[^.]+$/.test(file);
}

export async function listProductFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    if (files.length >= MAX_FILES) return;
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      if (entry.isFile() && isScannable(path) && !/__tests__|__mocks__/.test(path)) files.push(path);
      if (files.length >= MAX_FILES) return;
    }
  }
  await visit(root);
  return files;
}

/** `// uxqa-ignore basic/no-hardcoded-color -- 理由` on the same line or the line before. */
function readIgnores(text: string): Map<number, IgnoreMark> {
  const marks = new Map<number, IgnoreMark>();
  const lines = text.split('\n');
  lines.forEach((raw, index) => {
    // HTML comments in Vue / Svelte markup: `<!-- uxqa-ignore basic/img-alt -- 理由 -->`.
    const line = raw.replace(/\s*-->\s*$/, '');
    const match = line.match(/uxqa-ignore(?:-next-line)?\s+([\w/*,.-]+)\s*(?:(?:--|：|:)\s*([^*}]*?))?\s*(?:\*\/\s*\}?)?\s*$/);
    if (!match) return;
    const mark: IgnoreMark = { rules: match[1].split(',').map((rule) => rule.trim()).filter(Boolean), ...(match[2]?.trim() ? { reason: match[2].trim() } : {}) };
    const codeBefore = line.slice(0, line.indexOf('uxqa-ignore')).replace(/\/\/\s*$|\/\*\s*$|\{\s*\/\*\s*$|<!--\s*$/, '').trim();
    marks.set(index + 1, mark);
    if (!codeBefore) marks.set(index + 2, mark);
  });
  return marks;
}

function jsxAttributes(node: ts.JsxOpeningLikeElement): Map<string, ts.JsxAttribute> {
  const attributes = new Map<string, ts.JsxAttribute>();
  for (const property of node.attributes.properties) {
    if (ts.isJsxAttribute(property)) attributes.set(property.name.getText(), property);
  }
  return attributes;
}

function literalAttribute(attribute: ts.JsxAttribute | undefined): string | undefined {
  const initializer = attribute?.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression && ts.isStringLiteralLike(initializer.expression)) return initializer.expression.text;
  return undefined;
}

function childText(node: ts.JsxOpeningLikeElement): string | undefined {
  if (!ts.isJsxOpeningElement(node) || !ts.isJsxElement(node.parent)) return undefined;
  const parts = node.parent.children.flatMap((child) => ts.isJsxText(child) ? [child.text] : []);
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) { found = true; return; }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}


const PATTERN_MAX_DEPTH = 5;
const PATTERN_MAX_NODES = 40;

/** Static class tokens from className="..", className={`..`}, className={cn("..", cond && "..")}. */
function staticClasses(attribute: ts.JsxAttribute | undefined): string[] {
  const initializer = attribute?.initializer;
  if (!initializer) return [];
  const texts: string[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) { texts.push(node.text); return; }
    if (ts.isTemplateExpression(node)) { texts.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text)); return; }
    ts.forEachChild(node, collect);
  };
  collect(initializer);
  return [...new Set(texts.join(' ').split(/\s+/).filter((token) => token && !token.includes('${')))].sort();
}

interface Shape { exact: string; loose: string; size: number; classes: string[] }

/** Structure fingerprint of a JSX subtree: tags, roles, input types and static classes; text and values are ignored. */
function shapeOf(node: ts.JsxElement | ts.JsxSelfClosingElement, source: ts.SourceFile, depth = 0, budget = { nodes: 0 }): Shape | undefined {
  if (depth > PATTERN_MAX_DEPTH || budget.nodes >= PATTERN_MAX_NODES) return undefined;
  budget.nodes++;
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const tag = opening.tagName.getText(source);
  const attributes = jsxAttributes(opening);
  const classes = staticClasses(attributes.get('className'));
  const role = literalAttribute(attributes.get('role'));
  const type = literalAttribute(attributes.get('type'));
  const head = `${tag}${role ? `[role=${role}]` : ''}${type ? `[type=${type}]` : ''}`;
  const children: Shape[] = [];
  if (ts.isJsxElement(node)) {
    for (const child of node.children) {
      const elements: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) elements.push(child);
      else if (ts.isJsxExpression(child) && child.expression) {
        // `{cond && <x/>}` and `{items.map(() => <x/>)}`: take the first-level elements inside.
        const find = (inner: ts.Node): void => {
          if (ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner)) { elements.push(inner); return; }
          ts.forEachChild(inner, find);
        };
        find(child.expression);
      }
      for (const element of elements) {
        const shape = shapeOf(element, source, depth + 1, budget);
        if (shape) children.push(shape);
      }
    }
  }
  const exactChildren = children.map((child) => child.exact).join(',');
  const looseChildren = children.map((child) => child.loose).join(',');
  return {
    exact: `${head}{${classes.join(' ')}}${children.length ? `(${exactChildren})` : ''}`,
    loose: `${head}${children.length ? `(${looseChildren})` : ''}`,
    size: 1 + children.reduce((sum, child) => sum + child.size, 0),
    classes: [...new Set([...classes, ...children.flatMap((child) => child.classes)])],
  };
}

function scanScript(file: string, rel: string, text: string): Observation[] {
  const source = parseSource(file, text);
  const observations: Observation[] = [];
  const at = (node: ts.Node, offset?: number) => {
    const start = offset ?? node.getStart(source);
    const { line, character } = source.getLineAndCharacterOfPosition(start);
    return { file: rel, line: line + 1, column: character + 1, snippet: trimSnippet(source.text.split('\n')[line] ?? '') };
  };

  // The intrinsic element whose className this literal belongs to (className="…", className={cn("…")}), if any.
  // First piece of visible text inside a JSX subtree, used to name problems ("「提交」按钮").
  const firstText = (node: ts.Node): string | undefined => {
    let found: string | undefined;
    const visit = (child: ts.Node): void => {
      if (found) return;
      if (ts.isJsxText(child)) {
        const text = child.text.replace(/\s+/g, ' ').trim();
        if (meaningful(text)) { found = text; return; }
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };
  // Only the element's own text, so an outer container is not named after text deep inside it.
  const ownText = (element: ts.JsxElement): string | undefined => {
    const text = element.children.flatMap((child) => ts.isJsxText(child) ? [child.text] : []).join(' ').replace(/\s+/g, ' ').trim();
    return meaningful(text) ? text : undefined;
  };
  // The element whose className this literal belongs to (className="…", className={cn("…")}), if any.
  const enclosingElement = (node: ts.Node): { tag?: string; text?: string } | undefined => {
    for (let current: ts.Node | undefined = node.parent, depth = 0; current && depth < 8; current = current.parent, depth++) {
      if (ts.isJsxAttribute(current)) {
        if (current.name.getText(source) !== 'className') return undefined;
        const opening = current.parent.parent;
        if (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening)) return undefined;
        const tag = opening.tagName.getText(source);
        const text = ts.isJsxOpeningElement(opening) && ts.isJsxElement(opening.parent) ? ownText(opening.parent) : undefined;
        return { ...(/^[a-z][a-z0-9]*$/.test(tag) ? { tag } : {}), ...(text ? { text } : {}) };
      }
      if (ts.isJsxElement(current) || ts.isFunctionLike(current)) return undefined;
    }
    return undefined;
  };
  // A wide element inside a horizontally scrolling box (a wide table in `overflow-x-auto`) is intentional.
  const insideScroller = (node: ts.Node): boolean => {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
      if (ts.isJsxElement(current)) {
        const classes = staticClasses(jsxAttributes(current.openingElement).get('className'));
        if (classes.some((name) => /^overflow-(x-)?(auto|scroll)$/.test(name))) return true;
      }
      if (ts.isFunctionLike(current) && !ts.isArrowFunction(current)) return false;
    }
    return false;
  };
  const scanClassText = (node: ts.Node, value: string, offset: number) => {
    const siblings = value.split(/\s+/).filter((token) => token && !token.includes('${'));
    const element = value.includes('[') ? enclosingElement(node) : undefined;
    const tag = element?.tag;
    const owner = element?.text ? { text: element.text } : {};
    for (const match of value.matchAll(ARBITRARY)) {
      const [, , prefix, raw] = match;
      const position = at(node, offset + (match.index ?? 0));
      if (COLOR_VALUE.test(raw)) observations.push({ kind: 'color', value: raw, context: 'class', token: match[0], classes: siblings, ...(tag ? { tag } : {}), ...owner, ...position });
      const size = raw.match(SIZE_VALUE);
      if (size && wideWidth(prefix, toPx(Math.abs(Number(size[1])), size[2])) && tag !== 'table' && !siblings.some((name) => /^overflow-(x-)?(auto|scroll)$/.test(name)) && !insideScroller(node)) observations.push({ kind: 'hint', check: 'wide-fixed-width', detail: raw, classes: siblings, ...(tag ? { tag } : {}), ...owner, ...position });
      if (size && Number(size[1]) !== 0) observations.push({ kind: 'size', raw: match[0].replace(/^(?:[a-z0-9-]+:)*/, ''), px: toPx(Math.abs(Number(size[1])), size[2]), prefix, context: 'class', token: match[0], classes: siblings, ...(tag ? { tag } : {}), ...owner, ...position });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      observations.push({ kind: 'import', module: node.moduleSpecifier.text, ...at(node) });
    }
    if ((ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text) && node.body && containsJsx(node.body))) {
      observations.push({ kind: 'definition', name: node.name.text, ...at(node.name) });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z][A-Za-z0-9]*$/.test(node.name.text) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer) || ts.isCallExpression(node.initializer)) && containsJsx(node.initializer)) {
      observations.push({ kind: 'definition', name: node.name.text, ...at(node.name) });
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attributes = jsxAttributes(node);
      if (/^[a-z][a-z0-9]*$/.test(tag)) {
        const role = literalAttribute(attributes.get('role'));
        const inputType = literalAttribute(attributes.get('type'));
        const label = childText(node);
        observations.push({ kind: 'intrinsic', tag, ...(role ? { role } : {}), ...(tag === 'input' && inputType ? { inputType } : {}), ...(label ? { text: label } : {}), classes: staticClasses(attributes.get('className')), ...at(node) });
      } else {
        const label = childText(node);
        observations.push({ kind: 'usage', component: tag.split('.').pop()!, props: [...attributes.keys()], ...(label ? { text: label } : {}), ...at(node) });
      }
      for (const hint of jsxHints(node, attributes, staticClasses(attributes.get('className')), source, childText(node))) observations.push({ kind: 'hint', ...hint, ...at(node) });
      const style = attributes.get('style')?.initializer;
      if (style && ts.isJsxExpression(style) && style.expression && ts.isObjectLiteralExpression(style.expression)) {
        for (const property of style.expression.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key = property.name.getText(source).replace(/['"]/g, '');
          const value = property.initializer;
          const number = ts.isNumericLiteral(value) ? Number(value.text) : ts.isStringLiteralLike(value) ? parseFloat(value.text) : NaN;
          if (key === 'zIndex' && number >= 1000) observations.push({ kind: 'hint', check: 'huge-z-index', detail: String(number), ...at(value) });
          if ((key === 'width' || key === 'minWidth') && number >= 480 && (ts.isNumericLiteral(value) || /^\s*\d+(\.\d+)?px\s*$/.test(value.getText(source).replace(/['"`]/g, '')))) observations.push({ kind: 'hint', check: 'wide-fixed-width', detail: `${number}px`, ...at(value) });
          if (STYLE_COLOR_KEYS.has(key) && ts.isStringLiteralLike(value) && COLOR_IN_TEXT.test(value.text)) {
            observations.push({ kind: 'color', value: value.text.match(COLOR_IN_TEXT)![0], context: 'style', ...at(value) });
          }
          if (STYLE_SIZE_KEYS.test(key)) {
            const prefix = stylePrefix(key);
            if (ts.isNumericLiteral(value) && Number(value.text) !== 0) observations.push({ kind: 'size', raw: `${key}: ${value.text}`, px: Number(value.text), ...(prefix ? { prefix } : {}), context: 'style', ...at(value) });
            if (ts.isStringLiteralLike(value)) {
              const size = value.text.trim().match(SIZE_VALUE);
              if (size && Number(size[1]) !== 0) observations.push({ kind: 'size', raw: `${key}: ${value.text}`, px: toPx(Math.abs(Number(size[1])), size[2]), ...(prefix ? { prefix } : {}), context: 'style', ...at(value) });
            }
          }
        }
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) scanClassText(node, node.text, node.getStart(source) + 1);
    if (ts.isTemplateExpression(node)) {
      scanClassText(node.head, node.head.text, node.head.getStart(source) + 1);
      for (const span of node.templateSpans) scanClassText(span.literal, span.literal.text, span.literal.getStart(source) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Repeated markup that is not a component yet: fingerprint every styled subtree of three or more elements.
  const patterns = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const shape = shapeOf(node, source);
      if (shape && shape.size >= 3 && shape.classes.length >= 3) {
        const start = node.getStart(source);
        const position = at(node, start);
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const rootTag = opening.tagName.getText(source);
        const rootClasses = staticClasses(jsxAttributes(opening).get('className'));
        const text = firstText(node);
        observations.push({ kind: 'pattern', ...shape, rootTag, rootClasses, ...(text ? { text } : {}), endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1, start, end: node.getEnd(), ...position });
      }
    }
    ts.forEachChild(node, patterns);
  };
  patterns(source);
  return observations;
}

function scanCss(rel: string, text: string, lang = 'css'): Observation[] {
  const observations: Observation[] = [];
  const lines = text.split('\n');
  for (const hint of cssHints(text)) observations.push({ kind: 'hint', ...hint, file: rel, column: 1, snippet: trimSnippet(lines[hint.line - 1] ?? '') });
  text.split('\n').forEach((line, index) => {
    // Every `property: value` pair on the line, including one-line rules such as `.a { color: #f00; }`.
    for (const declaration of line.matchAll(/(?<![\w-])([a-zA-Z][a-zA-Z-]*)\s*:\s*([^;{}]+)/g)) {
      if (line.slice(0, declaration.index).trimEnd().endsWith('-')) continue;
      // Sass / Less variables (`$primary: #1a73e8`, `@primary: …`) define colours, they do not hard-code them.
      if (lang !== 'css' && /[$@]$/.test(line.slice(0, declaration.index))) continue;
      const color = declaration[2].match(COLOR_IN_TEXT);
      if (!color) continue;
      observations.push({ kind: 'color', value: color[0], context: 'css', file: rel, line: index + 1, column: (declaration.index ?? 0) + 1, snippet: trimSnippet(line) });
    }
  });
  return observations;
}

function scanHtml(rel: string, text: string): Observation[] {
  const lines = text.split('\n');
  return htmlHints(text).map((hint) => ({ kind: 'hint' as const, ...hint, file: rel, column: 1, snippet: trimSnippet(lines[hint.line - 1] ?? '') }));
}

export async function scanFile(productRoot: string, file: string): Promise<ScannedFile> {
  const rel = toPosix(relative(productRoot, file));
  const stat = await lstat(file).catch(() => undefined);
  if (!stat?.isFile()) return { file: rel, observations: [], ignores: new Map(), parseError: '文件不存在或不是普通文件' };
  if (stat.size > MAX_BYTES) return { file: rel, observations: [], ignores: new Map(), parseError: `文件超过 ${MAX_BYTES / 1000} KB，未检查` };
  const text = await readFile(file, 'utf8');
  try {
    const ext = extname(file);
    const observations = ext === '.html' ? scanHtml(rel, text) : STYLE_EXT.has(ext) ? scanCss(rel, text)
      : COMPONENT_EXT.has(ext) ? scanComponentFile(rel, text, ext === '.vue' ? 'vue' : 'svelte', { script: (lang, masked) => scanScript(`component.${lang}`, rel, masked), style: (lang, masked) => scanCss(rel, masked, lang) })
      : scanScript(file, rel, text);
    return { file: rel, observations, ignores: readIgnores(text) };
  } catch (error) {
    return { file: rel, observations: [], ignores: new Map(), parseError: error instanceof Error ? error.message : String(error) };
  }
}
