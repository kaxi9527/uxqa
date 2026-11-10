import { createHash } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { globToRegExp } from '../glob.js';
import { componentByName, findProductRoot, libraryLabel, readInventory, toPosix, type Inventory, type LibraryComponent } from '../inventory/read.js';
import { componentLabel, NATIVE_MAPPINGS } from '../inventory/semantics.js';
import { BASIC_VERSION, buildRuleSet, readRuleFile, RuleConfigError, validateAgainstInventory } from '../rules/load.js';
import type { Rule, RuleLevel, RuleSet } from '../rules/types.js';
import { readBaseline, type Baseline } from './baseline.js';
import { colorExamples, describeVariants, elementLabel, importHint, pxText, quote, sizeKind, isFontSizePrefix, isSpacingPrefix, nearestColorToken, nearestSize, type PlainMessage } from './messages.js';
import type { AiNote } from '../ai/review.js';
import { HINT_RULES } from './hints.js';
import { matchVariants, variantAdvice } from './variants.js';
import { planMerge, type Site } from './merge.js';
import { isScannable, listProductFiles, scanFile, type Observation, type ScannedFile } from './scan.js';

export interface Violation extends PlainMessage {
  rule: string;
  level: Exclude<RuleLevel, 'off'>;
  /** 'ai' marks a problem found by looking at screenshots (vision model or the user's agent), not by a rule program. */
  origin: Rule['origin'] | 'ai';
  file: string;
  line: number;
  column: number;
  snippet: string;
  /** Technical detail for people who want it and for the AI fix prompt. */
  detail: string;
  /** props: the closest existing style options; missing: styling no option provides (a new option is proposed). */
  suggestion?: { component: string; importHint: string; variants?: Record<string, string[]>; props?: Record<string, string>; missing?: string[] };
  status: 'new' | 'baseline' | 'ignored';
  ignoreReason?: string;
  /** Repeated markup only: copies × elements per copy, used to list the most worthwhile components first. */
  weight?: number;
  /** How to find this problem on a rendered page (by features, not by source mapping). */
  locate?: Locator;
  fingerprint: string;
  /** Second opinion from looking at the screenshot; never changes the finding itself. */
  ai?: AiNote;
  /** Repeated markup only: every copy, and a step-by-step plan to turn them into one component. */
  sites?: Site[];
  plan?: string[];
}

export interface Locator { tag?: string; role?: string; inputType?: string; classes?: string[]; text?: string; token?: string }

export interface CheckOptions {
  source: string;
  files?: string[];
  rulesPath?: string;
  baselinePath?: string;
}

export interface CheckResult {
  productRoot: string;
  library: { path?: string; source: Inventory['source']; components: number; tokens: number; issues: string[] };
  rules: { source?: string; basic: string | null; active: Array<{ id: string; level: RuleLevel; origin: Rule['origin'] }>; disabled: RuleSet['disabled']; guidance: RuleSet['guidance'] };
  scope: 'files' | 'project';
  filesScanned: number;
  skipped: Array<{ file: string; reason: string }>;
  violations: Violation[];
  /** Names of components the project defines outside its libraries (page-level components). */
  components?: string[];
  ignoreWithoutReason: Array<{ file: string; line: number }>;
  baseline?: { path: string; entries: number; fixed: number };
  summary: { newMust: number; newDefault: number; newReference: number; baseline: number; ignored: number };
  durationMs: number;
}

function matchesAny(globs: string[], file: string): boolean {
  return globs.some((glob) => globToRegExp(glob.replace(/^\.\//, '')).test(file));
}

function inScope(rule: Rule, file: string): boolean {
  if (rule.include.length && !matchesAny(rule.include, file)) return false;
  return !matchesAny(rule.exclude, file);
}

function inLibrary(inventory: Inventory, file: string): boolean {
  return inventory.libraryFolders.some((folder) => file === folder || file.startsWith(`${folder}/`));
}

function fingerprintBase(rule: string, file: string, subject: string): string {
  return createHash('sha256').update(`${rule}\n${file}\n${subject.replace(/\s+/g, ' ').trim()}`).digest('hex').slice(0, 16);
}

/** Which library component replaces a hand-written element, most specific mapping first. */
function mappedComponent(inventory: Inventory, observation: Extract<Observation, { kind: 'intrinsic' }>): { component: LibraryComponent; label: string } | undefined {
  if (observation.tag === 'input' && ['hidden', 'file', 'image'].includes(observation.inputType ?? '')) return undefined;
  const inputAsButton = observation.tag === 'input' && ['submit', 'reset', 'button'].includes(observation.inputType ?? '');
  for (const mapping of NATIVE_MAPPINGS) {
    const element = inputAsButton ? 'button' : observation.tag;
    if (mapping.element !== element) continue;
    if (mapping.role && mapping.role !== observation.role) continue;
    if (mapping.inputType && mapping.inputType !== observation.inputType) continue;
    if (!mapping.role && !mapping.inputType && observation.role && observation.role !== mapping.element && observation.role !== 'button') continue;
    if (!mapping.inputType && element === 'input' && observation.inputType && ['checkbox', 'radio', 'range'].includes(observation.inputType)) continue;
    for (const name of mapping.components) {
      const component = componentByName(inventory, name);
      if (component) return { component, label: mapping.label };
    }
    return undefined;
  }
  return undefined;
}

/** CSS selectors for the controls the library has a component for (only those count toward reuse). */
export function coveredSelectors(inventory: Inventory): string[] {
  const textInputs = 'input:not([type]),input[type=text],input[type=email],input[type=search],input[type=password],input[type=number],input[type=tel],input[type=url]';
  const selectors: string[] = [];
  for (const mapping of NATIVE_MAPPINGS) {
    if (['label', 'table', 'hr', 'progress'].includes(mapping.element) || mapping.role === 'tooltip' || mapping.role === 'progressbar') continue;
    if (!mapping.components.some((name) => componentByName(inventory, name))) continue;
    if (mapping.role) selectors.push(`${mapping.element}[role=${mapping.role}]`);
    else if (mapping.inputType) selectors.push(`input[type=${mapping.inputType}]`);
    else if (mapping.element === 'input') selectors.push(textInputs);
    else if (mapping.element === 'button') selectors.push('button:not([role])');
    else selectors.push(mapping.element);
  }
  return [...new Set(selectors)];
}

function elementText(observation: Extract<Observation, { kind: 'intrinsic' }>): string {
  return `<${observation.tag}${observation.role ? ` role="${observation.role}"` : ''}${observation.inputType ? ` type="${observation.inputType}"` : ''}>`;
}

/** `subject` is what exactly is wrong (an element, a colour value, a size); it identifies a problem across unrelated edits of the same line. */
type Draft = Omit<Violation, 'status' | 'fingerprint' | 'level' | 'origin' | 'rule'> & { subject: string; anchor?: string };
type Pattern = Extract<Observation, { kind: 'pattern' }>;

function overlap(a: string[], b: string[]): number {
  const left = new Set(a);
  const shared = b.filter((token) => left.has(token)).length;
  return shared / Math.max(1, new Set([...a, ...b]).size);
}

/** Markup that repeats but is not a component yet. Groups identical copies first, then near-identical ones; reports only the largest repeating block. */
function repeatedPatterns(rule: Rule, inventory: Inventory, patterns: Pattern[], targets?: Set<string>): Draft[] {
  const min = rule.minOccurrences ?? 3;
  const candidates = patterns.filter((pattern) => !inLibrary(inventory, pattern.file) && inScope(rule, pattern.file));
  const files = (list: Pattern[]) => new Set(list.map((entry) => entry.file)).size;
  // Identical: `min` copies anywhere, or two copies in different files when each copy is a real block (4+ elements).
  // A project-set minOccurrences is the only threshold; the two-files shortcut applies to the default only.
  const qualifies = (list: Pattern[]) => list.length >= min || (rule.minOccurrences === undefined && list.length >= 2 && files(list) >= 2 && list[0].size >= 4);
  // Near-identical needs more evidence: `min` copies across 2+ files, 4+ elements each, 60%+ shared style classes.
  const qualifiesSimilar = (list: Pattern[]) => list.length >= min && files(list) >= 2 && list[0].size >= 4;
  const groups: Array<{ kind: 'same' | 'similar'; key: string; items: Pattern[] }> = [];
  const byExact = new Map<string, Pattern[]>();
  for (const pattern of candidates) byExact.set(pattern.exact, [...(byExact.get(pattern.exact) ?? []), pattern]);
  for (const [key, items] of byExact) if (qualifies(items)) groups.push({ kind: 'same', key, items });
  const byLoose = new Map<string, Pattern[]>();
  for (const pattern of candidates) byLoose.set(pattern.loose, [...(byLoose.get(pattern.loose) ?? []), pattern]);
  for (const [key, items] of byLoose) {
    if (new Set(items.map((item) => item.exact)).size < 2 || !qualifiesSimilar(items)) continue;
    const similar = items.filter((item) => overlap(item.classes, items[0].classes) >= 0.6);
    if (qualifiesSimilar(similar) && new Set(similar.map((item) => item.exact)).size >= 2) groups.push({ kind: 'similar', key, items: similar });
  }
  groups.sort((a, b) => b.items[0].size - a.items[0].size || b.items.length - a.items.length || (a.kind === 'same' ? -1 : 1));

  const covered = new Map<string, Array<[number, number]>>();
  const inside = (item: Pattern) => (covered.get(item.file) ?? []).some(([start, end]) => item.start >= start && item.end <= end);
  const drafts: Draft[] = [];
  for (const group of groups) {
    const items = [...group.items].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    if (items.every(inside)) continue;
    for (const item of items) covered.set(item.file, [...(covered.get(item.file) ?? []), [item.start, item.end]]);
    const fileSet = new Set(items.map((item) => item.file));
    const report = (targets ? items.find((item) => targets.has(item.file)) : undefined) ?? items[0];
    const others = items.filter((item) => item !== report);
    const where = others.slice(0, 3).map((item) => `${item.file}:${item.line}`).join('、') + (others.length > 3 ? ` 等 ${others.length} 处` : '');
    drafts.push({
      name: (() => {
        const base = elementLabel(/^[a-z]/.test(report.rootTag) ? report.rootTag : undefined, report.rootClasses)
          ?? (/^[A-Z]/.test(report.rootTag) ? `${componentLabel(report.rootTag.split('.').pop()!) ?? report.rootTag}组合` : '结构');
        const label = `${base}${report.text ? `（含${quote(report.text, 10)}）` : ''}`;
        return group.kind === 'same' ? `这段${label}写了 ${items.length} 份，可以做成组件` : `${items.length} 段相似的${label}，可以合成一个组件`;
      })(),
      title: '可以做成组件',
      what: group.kind === 'same'
        ? `这一段写法在 ${fileSet.size} 个文件里一模一样地出现了 ${items.length} 次，还没有做成组件。其他位置：${where}。`
        : `差不多的写法出现了 ${items.length} 次（${fileSet.size} 个文件），只是样子略有不同，还没有做成组件。其他位置：${where}。`,
      consequence: '以后要改它，得一处一处地改，很容易漏掉，或者改得各处不一样。',
      fix: rule.origin === 'project' && rule.fix ? rule.fix
        : group.kind === 'same' ? '把这一段做成组件库里的一个组件，起一个说明用途的名字，各处改成引用它。'
        : '把它做成组件库里的一个组件，几处不同的样子做成这个组件的不同样式选项，各处改成引用它。',
      detail: `${group.kind === 'same' ? '相同结构' : '相近结构（样式类重合 ≥ 60%）'}，每处 ${report.size} 个元素：${items.map((item) => `${item.file}:${item.line}-${item.endLine}`).join('，')}`,
      subject: `${group.kind}:${group.key}`,
      anchor: 'pattern',
      weight: items.length * report.size,
      sites: items.map((item) => ({ file: item.file, line: item.line, start: item.start, end: item.end })),
      ...(/^[a-z]/.test(report.rootTag) && report.rootClasses.length ? { locate: { tag: report.rootTag, classes: report.rootClasses } } : {}),
      file: report.file, line: report.line, column: report.column, snippet: report.snippet,
    });
  }
  return drafts;
}

function applyRule(rule: Rule, inventory: Inventory, files: ScannedFile[], allDefinitions: Array<Extract<Observation, { kind: 'definition' }>>, allPatterns: Pattern[], targets?: Set<string>): Draft[] {
  if (rule.type === 'repeated-pattern') return repeatedPatterns(rule, inventory, allPatterns, targets);
  const drafts: Draft[] = [];
  const pick = (kind: Observation['kind']) => files.flatMap((file) => inLibrary(inventory, file.file) && kind !== 'definition' && kind !== 'import' && kind !== 'usage' ? [] : file.observations.filter((observation) => observation.kind === kind && inScope(rule, observation.file)));

  switch (rule.type) {
    case 'use-library-component':
    case 'require-library-component': {
      for (const observation of pick('intrinsic') as Array<Extract<Observation, { kind: 'intrinsic' }>>) {
        let target: { component: LibraryComponent; label: string } | undefined;
        if (rule.type === 'require-library-component') {
          if (observation.tag !== rule.element || (rule.role && observation.role !== rule.role) || (rule.inputType && observation.inputType !== rule.inputType)) continue;
          const component = componentByName(inventory, rule.component!);
          if (!component) continue;
          target = { component, label: component.label ?? component.name };
        } else target = mappedComponent(inventory, observation);
        if (!target) continue;
        const { component, label } = target;
        const variants = describeVariants(component);
        const match = matchVariants(component, observation.classes);
        drafts.push({
          name: observation.text ? `${quote(observation.text)}${label}是手写的，应改用 ${component.name}` : `手写的${label}，应改用 ${component.name}`,
          title: '没用组件库',
          what: `这里手写了一个${label}（${elementText(observation)}），组件库里已经有现成的${label}：${component.name}。`,
          consequence: `以后改${label}的样子，这里不会跟着变，页面之间会越来越不一致。`,
          fix: rule.origin === 'project' && rule.fix ? rule.fix : match ? variantAdvice(component, match, component.library) : `换成${component.library ? `组件库「${component.library}」` : '组件库'}里的 ${component.name}${variants ? `（${variants}）` : ''}。`,
          subject: elementText(observation),
          locate: { tag: observation.tag, ...(observation.role ? { role: observation.role } : {}), ...(observation.inputType ? { inputType: observation.inputType } : {}), classes: observation.classes, ...(observation.text ? { text: observation.text } : {}) },
          detail: `${elementText(observation)} → ${component.name}，${importHint(component, inventory)}；组件定义在 ${component.file}`,
          suggestion: { component: component.name, importHint: importHint(component, inventory), ...(Object.keys(component.variants).length ? { variants: component.variants } : {}), ...(match ? { props: match.props, ...(match.leftover.length ? { missing: match.leftover } : {}) } : {}) },
          file: observation.file, line: observation.line, column: observation.column, snippet: observation.snippet,
        });
      }
      break;
    }
    case 'no-duplicate-component': {
      const libraryNames = new Map<string, Array<Extract<Observation, { kind: 'definition' }>>>();
      const outsideNames = new Map<string, Array<Extract<Observation, { kind: 'definition' }>>>();
      for (const definition of allDefinitions) {
        const target = inLibrary(inventory, definition.file) ? libraryNames : outsideNames;
        target.set(definition.name, [...(target.get(definition.name) ?? []), definition]);
      }
      const exported = new Set(inventory.components.map((component) => component.name));
      for (const [name, definitions] of outsideNames) {
        const libraryOnes = libraryNames.get(name);
        if (libraryOnes?.length && exported.has(name)) {
          const preferred = componentByName(inventory, name);
          for (const definition of definitions.filter((entry) => inScope(rule, entry.file))) {
            drafts.push({
              name: `又写了一个 ${name}，组件库里已经有了`,
              title: '重复了',
              what: `这里又定义了一个 ${name}，组件库里已经有一个（${preferred?.file ?? libraryOnes[0].file}）。`,
              consequence: `两个 ${name} 会越改越不一样，改了组件库里的，这里不会变。`,
              fix: `删掉这里自己写的 ${name}，改成从组件库引入 ${name}（${preferred?.file ?? libraryOnes[0].file}），把这个文件里用到它的地方一起改过去；如果它和组件库的 ${name} 用途不同，就改一个能说明用途的名字。`,
              subject: `definition:${name}`,
              detail: `同名组件：${definition.file}:${definition.line} 与 ${preferred?.file ?? libraryOnes[0].file}`,
              file: definition.file, line: definition.line, column: definition.column, snippet: definition.snippet,
            });
          }
        }
      }
      for (const [name, definitions] of libraryNames) {
        if (definitions.length < 2 || !exported.has(name)) continue;
        const preferred = componentByName(inventory, name);
        for (const definition of definitions.filter((entry) => entry.file !== preferred?.file && inScope(rule, entry.file))) {
          drafts.push({
            name: `组件库里有两个 ${name}`,
            title: '重复了',
            what: `组件库里有两个 ${name}：${preferred?.file} 和这里。`,
            consequence: `不同页面可能用到不同的 ${name}，改一个另一个不会变。`,
            fix: `先对比这两个的写法：如果用途一样，删掉这里的定义，改成从 ${preferred?.file} 引入 ${name}，并把用到这里的地方都改过去；如果用途不同，给这里的改一个能说明用途的名字（例如 Compact${name}），并说明它和 ${name} 的区别。`,
            subject: `definition:${name}`,
            detail: `组件库内同名组件：${definition.file}:${definition.line} 与 ${preferred?.file}`,
            file: definition.file, line: definition.line, column: definition.column, snippet: definition.snippet,
          });
        }
      }
      break;
    }
    case 'no-hardcoded-color': {
      for (const observation of pick('color') as Array<Extract<Observation, { kind: 'color' }>>) {
        const token = nearestColorToken(inventory.tokens, observation.value);
        const examples = token ? undefined : colorExamples(inventory.tokens, observation.context);
        drafts.push({
          name: `${observation.context === 'css' ? '样式文件里' : observation.context === 'style' ? '行内样式的' : observation.text ? `${quote(observation.text, 10)}的` : (elementLabel(observation.tag, observation.classes) ? `${elementLabel(observation.tag, observation.classes)}的` : '')}颜色写死成 ${observation.value}`,
          title: '颜色写死了',
          what: `这里直接写了颜色 ${observation.value}，没有用项目统一定义的颜色。`,
          consequence: '以后换主题色或做深色模式时，这里不会跟着变。',
          fix: rule.origin === 'project' && rule.fix ? rule.fix : token ? `改用项目颜色 ${token}（和 ${observation.value} 最接近）。` : `改用项目统一定义的颜色${examples ? `，例如 ${examples}` : ''}。`,
          subject: observation.value,
          ...(observation.token ? { locate: { token: observation.token, ...(observation.classes ? { classes: observation.classes } : {}), ...(observation.tag ? { tag: observation.tag } : {}), ...(observation.text ? { text: observation.text } : {}) } } : {}),
          detail: `${observation.context === 'class' ? '任意值类名' : observation.context === 'style' ? '行内样式' : 'CSS 声明'}：${observation.value}${token ? `；最接近的颜色变量 --${token}` : ''}`,
          file: observation.file, line: observation.line, column: observation.column, snippet: observation.snippet,
        });
      }
      break;
    }
    case 'no-arbitrary-size':
    case 'value-scale': {
      for (const observation of pick('size') as Array<Extract<Observation, { kind: 'size' }>>) {
        if (rule.type === 'value-scale') {
          const relevant = rule.property === 'font-size' ? isFontSizePrefix(observation.prefix) || /^fontSize/.test(observation.raw) : isSpacingPrefix(observation.prefix) || /^(padding|margin|gap)/.test(observation.raw);
          if (!relevant) continue;
          const allowed = rule.allowed === 'multiple-of-4' ? observation.px % 4 === 0 : (rule.allowed as number[]).includes(observation.px);
          if (allowed) continue;
          const allowedText = rule.allowed === 'multiple-of-4' ? ' 4 的倍数' : `这些值：${(rule.allowed as number[]).join('、')}px`;
          drafts.push({
            name: `${sizeKind(observation.prefix, observation.raw)} ${pxText(observation.px)} 不在统一档位上`,
            title: '尺寸不在统一档位上',
            what: `这里的 ${observation.raw} 是 ${observation.px}px，项目规定只能用${allowedText}。`,
            consequence: '间距或字号会出现一两像素的不齐，页面看起来不整齐。',
            fix: rule.fix ?? (nearestSize(observation.prefix, observation.px) ? `改成${nearestSize(observation.prefix, observation.px)}。` : '改成允许范围里最接近的值。'),
            subject: observation.raw,
          ...(observation.token ? { locate: { token: observation.token, ...(observation.classes ? { classes: observation.classes } : {}), ...(observation.tag ? { tag: observation.tag } : {}), ...(observation.text ? { text: observation.text } : {}) } } : {}),
            detail: `${observation.raw}（${observation.px}px），规则 ${rule.id}`,
            file: observation.file, line: observation.line, column: observation.column, snippet: observation.snippet,
          });
          continue;
        }
        const nearest = nearestSize(observation.prefix, observation.px);
        drafts.push({
          name: `${observation.text ? `${quote(observation.text, 10)}的` : elementLabel(observation.tag, observation.classes) ? `${elementLabel(observation.tag, observation.classes)}的` : ''}${sizeKind(observation.prefix, observation.raw)}写死成 ${pxText(observation.px)}`,
          title: '尺寸写死了',
          what: `这里直接写了尺寸 ${observation.raw}，没有用项目统一的尺寸档位。`,
          consequence: '各处尺寸会慢慢对不齐，以后统一调整时这里不会跟着变。',
          fix: rule.origin === 'project' && rule.fix ? rule.fix
            : nearest ? (observation.context === 'style' ? `去掉行内样式，改用类名 ${nearest.replace(/^最接近的统一档位 /, '')}。` : `改成${nearest}。`)
            : /^(max|min)-/.test(observation.prefix ?? '') ? '如果这是特意定的宽度上限，用忽略注释写明理由；否则改用项目统一的尺寸档位。' : '改用项目统一的尺寸档位。',
          subject: observation.raw,
          ...(observation.token ? { locate: { token: observation.token, ...(observation.classes ? { classes: observation.classes } : {}), ...(observation.tag ? { tag: observation.tag } : {}), ...(observation.text ? { text: observation.text } : {}) } } : {}),
          detail: `${observation.context === 'class' ? '任意值类名' : '行内样式'}：${observation.raw}（${observation.px}px）`,
          file: observation.file, line: observation.line, column: observation.column, snippet: observation.snippet,
        });
      }
      break;
    }
    case 'forbid-import': {
      for (const observation of pick('import') as Array<Extract<Observation, { kind: 'import' }>>) {
        const module = rule.module!;
        const hit = module.includes('*') ? globToRegExp(module).test(observation.module) : observation.module === module || observation.module.startsWith(`${module}/`);
        if (!hit) continue;
        drafts.push({
          name: `引入了不该用的 ${observation.module}`,
          title: '用了不该用的库',
          what: `这里引入了 ${observation.module}，项目规定不用它。`,
          consequence: '项目里会出现两套样子和用法都不同的组件。',
          fix: rule.fix ?? '改用组件库里对应的组件。',
          subject: observation.module,
          detail: `import "${observation.module}"，规则 ${rule.id}`,
          file: observation.file, line: observation.line, column: observation.column, snippet: observation.snippet,
        });
      }
      break;
    }
    case 'require-prop': {
      for (const observation of pick('usage') as Array<Extract<Observation, { kind: 'usage' }>>) {
        if (observation.component !== rule.component || observation.props.includes(rule.prop!) || observation.props.includes('{...}')) continue;
        drafts.push({
          name: `${rule.component} 少了 ${rule.prop}`,
          title: '少写了必填项',
          what: `这里的 ${rule.component} 没有写 ${rule.prop}。`,
          consequence: `项目规定 ${rule.component} 必须带 ${rule.prop}，少了它会影响使用或展示。`,
          fix: rule.fix ?? `给它加上 ${rule.prop}。`,
          subject: `${rule.component}.${rule.prop}`,
          detail: `<${rule.component}> 缺少属性 ${rule.prop}，规则 ${rule.id}`,
          file: observation.file, line: observation.line, column: observation.column, snippet: observation.snippet,
        });
      }
      break;
    }
    case 'ui-check': {
      const hint = HINT_RULES[rule.check!];
      // These mistakes matter inside the component library too: fixing one library component fixes every page.
      const observations = files.flatMap((file) => file.observations.filter((observation): observation is Extract<Observation, { kind: 'hint' }> => observation.kind === 'hint' && observation.check === rule.check && inScope(rule, observation.file)));
      for (const observation of observations) {
        drafts.push({
          name: hint.name(observation),
          title: hint.title,
          what: hint.what(observation),
          consequence: hint.consequence,
          fix: rule.origin === 'project' && rule.fix ? rule.fix : hint.fix(observation),
          subject: `${observation.check}:${observation.text ?? ''}:${observation.detail ?? ''}:${observation.snippet}`,
          ...(observation.tag || observation.classes?.length || observation.text ? { locate: { ...(observation.tag && /^[a-z]/.test(observation.tag) ? { tag: observation.tag } : {}), ...(observation.classes?.length ? { classes: observation.classes } : {}), ...(observation.text ? { text: observation.text } : {}) } } : {}),
          detail: `${hint.title}${observation.detail ? `：${observation.detail}` : ''}`,
          file: observation.file, line: observation.line, column: observation.column, snippet: observation.snippet,
        });
      }
      break;
    }
    case 'text-length': {
      const names = new Set(rule.components ?? ['Button', 'button']);
      const candidates = [...pick('usage'), ...pick('intrinsic')] as Array<Extract<Observation, { kind: 'usage' | 'intrinsic' }>>;
      for (const observation of candidates) {
        const name = observation.kind === 'usage' ? observation.component : observation.tag;
        if (!names.has(name) || !observation.text) continue;
        const length = [...observation.text].length;
        if (length <= rule.max!) continue;
        drafts.push({
          name: `按钮文字${quote(observation.text)}太长`,
          title: '文字太长',
          what: `"${observation.text}" 有 ${length} 个字，项目规定最多 ${rule.max} 个。`,
          consequence: '窗口变窄时容易被截断或挤成两行。',
          fix: rule.fix ?? '缩短文字，或者把补充说明放到旁边。',
          subject: observation.text,
          detail: `${name} 文案长度 ${length} > ${rule.max}，规则 ${rule.id}`,
          file: observation.file, line: observation.line, column: observation.column, snippet: observation.snippet,
        });
      }
      break;
    }
  }
  return drafts;
}

function ignoreFor(file: ScannedFile | undefined, line: number, rule: string): { ignored: boolean; reason?: string; missingReason?: boolean } {
  const mark = file?.ignores.get(line);
  if (!mark || !(mark.rules.includes(rule) || mark.rules.includes('*') || mark.rules.some((entry) => rule.endsWith(`/${entry}`)))) return { ignored: false };
  if (!mark.reason) return { ignored: false, missingReason: true };
  return { ignored: true, reason: mark.reason };
}

export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const started = Date.now();
  const sourceRoot = await realpath(resolve(options.source));
  const ruleFile = await readRuleFile(await findProductRoot(sourceRoot), options.rulesPath);
  const ruleSet = buildRuleSet(ruleFile.raw, ruleFile.path);
  const inventory = await readInventory(sourceRoot, { ...(ruleSet.libraryRoot ? { root: ruleSet.libraryRoot } : {}), libraries: ruleSet.libraries });
  const configProblems = validateAgainstInventory(ruleSet, inventory);
  if (configProblems.length) throw new RuleConfigError(configProblems.join('\n'));
  const productRoot = inventory.productRoot;

  const skipped: CheckResult['skipped'] = [];
  let targets: string[];
  if (options.files?.length) {
    targets = [];
    for (const file of options.files) {
      // Relative paths are tried from the current directory first, then from the product root.
      let absolute = resolve(file);
      if (!isAbsolute(file) && !(await access(absolute).then(() => true, () => false))) absolute = resolve(productRoot, file);
      // Compare real paths: /tmp and /private/tmp (or any symlinked checkout) must count as the same project.
      absolute = await realpath(absolute).catch(() => absolute);
      const rel = toPosix(relative(productRoot, absolute));
      if (rel.startsWith('..')) { skipped.push({ file, reason: '不在这个项目里' }); continue; }
      if (!isScannable(absolute)) { skipped.push({ file: rel, reason: '不是需要检查的代码或样式文件' }); continue; }
      targets.push(absolute);
    }
  } else targets = await listProductFiles(productRoot);

  const scanned: ScannedFile[] = [];
  for (const file of targets) {
    const result = await scanFile(productRoot, file);
    if (result.parseError) skipped.push({ file: result.file, reason: result.parseError });
    scanned.push(result);
  }
  // Duplicate detection needs every definition in the library even when only a few files are checked.
  const allDefinitions = scanned.flatMap((file) => file.observations.filter((observation): observation is Extract<Observation, { kind: 'definition' }> => observation.kind === 'definition'));
  if (options.files?.length && inventory.libraryRoot) {
    const scannedFiles = new Set(scanned.map((file) => file.file));
    for (const file of await listProductFiles(inventory.libraryRoot)) {
      const result = await scanFile(productRoot, file);
      if (scannedFiles.has(result.file)) continue;
      allDefinitions.push(...result.observations.filter((observation): observation is Extract<Observation, { kind: 'definition' }> => observation.kind === 'definition'));
    }
  }

  // Repetition is a property of the whole project: when only some files are checked, still read the rest for patterns.
  const allPatterns = scanned.flatMap((file) => file.observations.filter((observation): observation is Pattern => observation.kind === 'pattern'));
  if (options.files?.length && ruleSet.rules.some((rule) => rule.type === 'repeated-pattern' && rule.level !== 'off')) {
    const scannedFiles = new Set(scanned.map((file) => file.file));
    for (const file of await listProductFiles(productRoot)) {
      const result = await scanFile(productRoot, file);
      if (scannedFiles.has(result.file)) continue;
      allPatterns.push(...result.observations.filter((observation): observation is Pattern => observation.kind === 'pattern'));
    }
  }

  const byFile = new Map(scanned.map((file) => [file.file, file]));
  const baseline: Baseline | undefined = options.baselinePath ? await readBaseline(options.baselinePath) : undefined;
  const baselineSet = new Set(baseline?.entries.map((entry) => entry.fingerprint) ?? []);
  const seen = new Map<string, number>();
  const violations: Violation[] = [];
  const ignoreWithoutReason: CheckResult['ignoreWithoutReason'] = [];

  for (const rule of ruleSet.rules) {
    if (rule.level === 'off') continue;
    let drafts = applyRule(rule, inventory, scanned, allDefinitions, allPatterns, options.files?.length ? new Set(byFile.keys()) : undefined);
    if (options.files?.length) drafts = drafts.filter((draft) => byFile.has(draft.file));
    drafts.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
    for (const draft of drafts) {
      const base = fingerprintBase(rule.id, draft.anchor ?? draft.file, draft.subject);
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      const fingerprint = `${base}#${occurrence}`;
      const ignore = ignoreFor(byFile.get(draft.file), draft.line, rule.id);
      if (ignore.missingReason) ignoreWithoutReason.push({ file: draft.file, line: draft.line });
      const { subject: _subject, anchor: _anchor, ...visible } = draft;
      void _subject; void _anchor;
      violations.push({
        ...visible, rule: rule.id, level: rule.level, origin: rule.origin, fingerprint,
        status: ignore.ignored ? 'ignored' : baselineSet.has(fingerprint) ? 'baseline' : 'new',
        ...(ignore.reason ? { ignoreReason: ignore.reason } : {}),
      });
    }
  }
  // A project scale rule, or the "fixed width too wide" check, is more specific than the generic "size is hard-coded" rule at the same spot.
  const scaled = new Set(violations.filter((violation) => ruleSet.rules.find((rule) => rule.id === violation.rule)?.type === 'value-scale' || violation.rule === 'basic/no-wide-fixed-width').map((violation) => `${violation.file}:${violation.line}:${violation.column}`));
  for (let index = violations.length - 1; index >= 0; index--) {
    const violation = violations[index];
    if (ruleSet.rules.find((rule) => rule.id === violation.rule)?.type === 'no-arbitrary-size' && scaled.has(`${violation.file}:${violation.line}:${violation.column}`)) violations.splice(index, 1);
  }
  // Merge plans read each copy's code; only for the repeated blocks this run reports.
  for (const violation of violations) {
    if (!violation.sites?.length || violation.status !== 'new') continue;
    const plan = await planMerge(productRoot, violation.sites, inventory.library, inventory.components.map((component) => component.name));
    if (plan) violation.plan = plan.lines;
  }
  violations.sort((a, b) => ({ must: 0, default: 1, reference: 2 }[a.level] - { must: 0, default: 1, reference: 2 }[b.level]) || (b.weight ?? 0) - (a.weight ?? 0) || a.file.localeCompare(b.file) || a.line - b.line);

  const fresh = violations.filter((violation) => violation.status === 'new');
  const matched = new Set(violations.filter((violation) => violation.status === 'baseline').map((violation) => violation.fingerprint));
  const relevantBaseline = baseline?.entries.filter((entry) => !options.files?.length || byFile.has(entry.file)) ?? [];
  return {
    productRoot,
    components: [...new Set(allDefinitions.filter((definition) => !inLibrary(inventory, definition.file)).map((definition) => definition.name))],
    library: { ...(libraryLabel(inventory) ? { path: libraryLabel(inventory) } : {}), source: inventory.source, components: inventory.components.length, tokens: inventory.tokens.length, issues: inventory.issues },
    rules: {
      ...(ruleSet.source ? { source: toPosix(relative(productRoot, ruleSet.source)) } : {}),
      basic: ruleSet.extends ? `${ruleSet.extends}@${BASIC_VERSION}` : null,
      active: ruleSet.rules.map((rule) => ({ id: rule.id, level: rule.level, origin: rule.origin })),
      disabled: ruleSet.disabled, guidance: ruleSet.guidance,
    },
    scope: options.files?.length ? 'files' : 'project',
    filesScanned: scanned.length - skipped.filter((entry) => byFile.has(entry.file)).length,
    skipped, violations, ignoreWithoutReason,
    ...(baseline && options.baselinePath ? { baseline: { path: options.baselinePath, entries: baseline.entries.length, fixed: relevantBaseline.filter((entry) => !matched.has(entry.fingerprint)).length } } : {}),
    summary: {
      newMust: fresh.filter((violation) => violation.level === 'must').length,
      newDefault: fresh.filter((violation) => violation.level === 'default').length,
      newReference: fresh.filter((violation) => violation.level === 'reference').length,
      baseline: violations.filter((violation) => violation.status === 'baseline').length,
      ignored: violations.filter((violation) => violation.status === 'ignored').length,
    },
    durationMs: Date.now() - started,
  };
}
