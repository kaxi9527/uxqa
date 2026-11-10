import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { viewOf } from './templates/element.js';
import { parseComponentFile, type Framework, type TemplateElement } from './templates/parse.js';

/**
 * A merge plan for markup repeated across the project: compare the copies element by element, turn differing
 * texts into props and differing styling into style options, and list what each copy becomes. It is a plan for
 * a person or an AI to carry out (then confirm with a before/after screenshot comparison), never an automatic rewrite.
 */
export interface Site { file: string; line: number; start: number; end: number }
export interface MergePlan {
  name: string;
  folder?: string;
  props: Array<{ name: string; values: string[] }>;
  styles: Array<{ name: string; classes: string[] }>;
  sites: Array<{ file: string; line: number; usage: string }>;
  shared: number;
  lines: string[];
}

/** texts: element index -> all text directly inside it, so copies are compared element by element. */
interface Shape { tags: string[]; classes: string[][]; texts: Map<string, string> }

/** Elements in order with their static classes, and every piece of visible text (literal or {expression}). */
function shapeOf(code: string): Shape | undefined {
  const source = ts.createSourceFile('x.tsx', `const x = (${code});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const shape: Shape = { tags: [], classes: [], texts: new Map() };
  const owners: number[] = [];
  // All text directly inside one element is one piece of content ("共 {n} 个 Agent"), keyed by the element.
  const add = (value: string) => { const owner = String(owners[owners.length - 1] ?? -1); shape.texts.set(owner, shape.texts.has(owner) ? `${shape.texts.get(owner)} ${value}` : value); };
  const classesOf = (node: ts.JsxOpeningLikeElement): string[] => {
    for (const property of node.attributes.properties) {
      if (!ts.isJsxAttribute(property) || property.name.getText(source) !== 'className' || !property.initializer) continue;
      const value = ts.isStringLiteral(property.initializer) ? property.initializer.text
        : ts.isJsxExpression(property.initializer) && property.initializer.expression && ts.isStringLiteralLike(property.initializer.expression) ? property.initializer.expression.text : '';
      return value.split(/\s+/).filter(Boolean).sort();
    }
    return [];
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      shape.tags.push(opening.tagName.getText(source));
      shape.classes.push(classesOf(opening));
      owners.push(shape.tags.length - 1);
      ts.forEachChild(node, visit);
      owners.pop();
      return;
    }
    if (ts.isJsxText(node) && node.text.trim()) add(node.text.replace(/\s+/g, ' ').trim());
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) { add(`{${node.expression.getText(source).replace(/\s+/g, ' ')}}`); return; }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return shape.tags.length ? shape : undefined;
}

/** The same shape read from a Vue / Svelte element: `{{ x }}` and `{x}` count as text, like JSX `{x}`. */
function templateShapeOf(element: TemplateElement, framework: Framework): Shape {
  const shape: Shape = { tags: [], classes: [], texts: new Map() };
  const add = (owner: number, value: string) => { const key = String(owner); shape.texts.set(key, shape.texts.has(key) ? `${shape.texts.get(key)} ${value}` : value); };
  const visit = (node: TemplateElement, owner: number): void => {
    const view = viewOf(node, framework);
    if (view.role === 'skip') return;
    let current = owner;
    if (view.role !== 'transparent') {
      shape.tags.push(view.tag);
      shape.classes.push(view.classes);
      current = shape.tags.length - 1;
    }
    for (const child of node.children) {
      if (child.type === 'text' && child.text.trim()) add(current, child.text.replace(/\s+/g, ' ').trim());
      if (child.type === 'expression') add(current, `{${child.code.replace(/\s+/g, ' ')}}`);
      if (child.type === 'element' && !child.content) visit(child, current);
    }
  };
  visit(element, -1);
  return shape;
}

function findElement(children: TemplateElement['children'], start: number): TemplateElement | undefined {
  for (const child of children) {
    if (child.type !== 'element') continue;
    if (child.start === start) return child;
    if (child.start < start && child.end > start) return findElement(child.children, start);
  }
  return undefined;
}

const PROP_NAMES = ['title', 'description', 'label', 'hint', 'extra'];

/** A prop name from what the values look like: changes ("+12%"), numbers ("¥9,800"), otherwise title/description/… */
function propName(values: string[], used: string[]): string {
  const pick = (name: string) => (used.includes(name) ? undefined : name);
  if (values.every((value) => /^[+\-−]?[\d.,]+%$/.test(value))) return pick('change') ?? `change${used.length + 1}`;
  if (values.every((value) => /^[¥$€£]?[+\-]?[\d.,]+\s*[KkMm万亿]?$/.test(value))) return pick('value') ?? `value${used.length + 1}`;
  return PROP_NAMES.find((name) => !used.includes(name)) ?? `text${used.length + 1}`;
}

const COLOR = /(?:^|-)(red|green|blue|yellow|orange|amber|emerald|sky|gray|slate|zinc|purple|pink|primary|secondary|destructive|muted|success|warning|danger)(?:-|$)/;

/** A style option named after its colour when that is the only difference, otherwise style2, style3… */
function styleName(classes: string[], index: number, used: string[]): string {
  const colours = [...new Set(classes.map((name) => name.split(':').pop()!.match(COLOR)?.[1]).filter(Boolean))] as string[];
  const name = colours.length === 1 ? colours[0] : `style${index + 1}`;
  return used.includes(name) ? `style${index + 1}` : name;
}

function pascal(words: string): string {
  return words.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join('');
}

/** A starting name from the root's look; the plan asks for a name that says what it is for. */
function suggestName(shape: Shape): string {
  const root = shape.classes[0] ?? [];
  const tags = new Set(shape.tags);
  if (tags.has('table') || tags.has('tr')) return 'DataRow';
  if (root.some((name) => /^(rounded|border|shadow|bg-card)/.test(name)) && root.some((name) => /^p-|^px-|^py-/.test(name))) return 'InfoCard';
  if (root.includes('flex') && [...tags].filter((tag) => /button|Button/.test(tag)).length >= 2) return 'ActionBar';
  if (/^[A-Z]/.test(shape.tags[0])) return `${pascal(shape.tags[0].split('.').pop()!)}Preset`;
  return 'RepeatedBlock';
}

export async function planMerge(productRoot: string, sites: Site[], library?: string, existing: string[] = []): Promise<MergePlan | undefined> {
  const shapes: Array<{ site: Site; shape: Shape }> = [];
  const cache = new Map<string, string>();
  const parsed = new Map<string, TemplateElement>();
  const frameworkOf = (file: string): Framework | undefined => (file.endsWith('.vue') ? 'vue' : file.endsWith('.svelte') ? 'svelte' : undefined);
  for (const site of sites) {
    let text = cache.get(site.file);
    if (text === undefined) { text = await readFile(join(productRoot, site.file), 'utf8').catch(() => ''); cache.set(site.file, text); }
    const framework = frameworkOf(site.file);
    if (framework) {
      if (!parsed.has(site.file)) parsed.set(site.file, parseComponentFile(text, framework));
      const element = findElement(parsed.get(site.file)!.children, site.start);
      const shape = element ? templateShapeOf(element, framework) : undefined;
      if (shape?.tags.length) shapes.push({ site, shape });
      continue;
    }
    const shape = shapeOf(text.slice(site.start, site.end));
    if (shape) shapes.push({ site, shape });
  }
  // Usage is written the way the copies' own files write markup.
  const framework = frameworkOf(shapes[0]?.site.file ?? '');
  if (shapes.length < 2) return undefined;
  const reference = shapes[0].shape;
  // Element-by-element: classes every copy shares stay in the component; the rest describe each copy's style.
  const count = Math.min(...shapes.map(({ shape }) => shape.tags.length));
  let shared = 0;
  const styleOf = shapes.map(() => [] as string[]);
  for (let index = 0; index < count; index++) {
    const lists = shapes.map(({ shape }) => shape.classes[index] ?? []);
    const common = lists[0].filter((name) => lists.every((list) => list.includes(name)));
    shared += common.length;
    lists.forEach((list, copy) => styleOf[copy].push(...list.filter((name) => !common.includes(name))));
  }
  const distinctStyles = [...new Set(styleOf.map((list) => list.join(' ')))];
  const styles: MergePlan['styles'] = [];
  if (distinctStyles.length > 1) distinctStyles.forEach((classes, index) => {
    const list = classes ? classes.split(' ') : [];
    styles.push({ name: index === 0 ? 'default' : styleName(list, index, styles.map((style) => style.name)), classes: list });
  });
  // Texts at the same place that differ between copies become props; text only some copies have is noted.
  const keys = [...new Set(shapes.flatMap(({ shape }) => [...shape.texts.keys()]))];
  const props: MergePlan['props'] = [];
  let extra = 0;
  for (const key of keys) {
    const values = shapes.map(({ shape }) => shape.texts.get(key));
    if (values.some((value) => value === undefined)) { extra++; continue; }
    if (new Set(values).size > 1) props.push({ name: propName(values as string[], props.map((prop) => prop.name)), values: values as string[] });
  }
  const taken = new Set(existing);
  let name = suggestName(reference);
  if (taken.has(name)) name = `Shared${name}`;
  const short = (value: string) => (value.length > 32 ? `${value.slice(0, 30)}…${value.startsWith('{') ? '}' : ''}` : value);
  const manyDifferences = props.length > 5;
  const usageFor = (copy: number) => {
    const attributes = props.slice(0, 5).map((prop) => {
      const raw = prop.values[copy];
      // Vue binds with :name="expression"; mixed text becomes a template string.
      if (framework === 'vue' && /^\{[^{}]*\}$/.test(raw)) return ` :${prop.name}="${short(raw.slice(1, -1))}"`;
      if (framework === 'vue' && raw.includes('{')) return ` :${prop.name}="\`${short(raw.replace(/\{([^{}]*)\}/g, '${$1}'))}\`"`;
      // Svelte writes {expression} and "text {expression}" directly.
      if (framework === 'svelte' && raw.includes('{') && !/^\{[^{}]*\}$/.test(raw)) return ` ${prop.name}="${short(raw)}"`;
      // A single {expression} passes as is; text mixed with {expressions} becomes a fragment; plain text a string.
      if (/^\{[^{}]*\}$/.test(raw)) return ` ${prop.name}=${short(raw)}`;
      if (raw.includes('{')) return ` ${prop.name}={<>${raw.length > 40 ? `${raw.slice(0, 38)}…` : raw}</>}`;
      return ` ${prop.name}=${JSON.stringify(short(raw))}`;
    }).join('');
    const style = styles.length ? styles.find((entry) => entry.classes.join(' ') === styleOf[copy].join(' ')) : undefined;
    return `<${name}${style && style.name !== 'default' ? ` variant="${style.name}"` : ''}${attributes} />`;
  };
  const sitesOut = shapes.map(({ site }, copy) => ({ file: site.file, line: site.line, usage: usageFor(copy) }));
  const folder = library ? `${library}/` : '组件库目录';
  const sizes = new Set(shapes.map(({ shape }) => shape.tags.length));
  const styleLine = styles.length ? `3. 各处不一样的样式做成样式选项 variant（名字可以按用途改，例如 up / down）：${styles.map((style) => `${style.name}（${style.classes.join(' ') || '无额外样式'}）`).join('；')}。`
    : shared ? '3. 各处样式一样，不需要样式选项。' : '3. 这几处都没写样式类（样子来自里面用到的组件），不需要样式选项。';
  const lines = [
    `1. 在 ${folder} 新建组件 ${name}（这是暂定名，请按用途改成能说明它是什么的名字），结构照 ${sitesOut[0].file}:${sitesOut[0].line} 那一份${shared ? `，${shared} 个各处都一样的样式写在组件里` : ''}。${sizes.size > 1 ? `几处的结构略有不同（元素数量不一样），多出来的部分用 ${framework ? '插槽（<slot />）' : 'children'} 传进去。` : ''}`,
    manyDifferences ? `2. 各处有 ${props.length} 处文字不一样，属性太多不好用：把不一样的那部分作为 ${framework ? '插槽（<slot />）' : 'children（或几个"插槽"属性）'}传进去，组件只负责外框和样式。`
      : props.length ? `2. 各处不一样的文字做成属性：${props.map((prop) => `${prop.name}（${[...new Set(prop.values)].slice(0, 4).map((value) => short(value)).join(' / ')}）`).join('；')}。` : '2. 各处文字一样，不需要额外的属性。',
    ...(extra ? [`   另外有 ${extra} 段文字只在部分位置出现，做成可选属性或${framework ? '插槽' : ' children'}。`] : []),
    styleLine,
    `4. 把这 ${sitesOut.length} 处换成新组件${manyDifferences ? '（下面只写了前 5 个属性）' : ''}：${sitesOut.map((site) => `${site.file}:${site.line} → ${site.usage}`).join('；')}。`,
    '5. 换完重新检测，并在控制台对比这几页改前改后的截图，外观应当没有变化；有变化的逐条确认。',
  ];
  return { name, ...(library ? { folder: library } : {}), props, styles, sites: sitesOut, shared, lines };
}
