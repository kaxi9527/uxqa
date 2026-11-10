import { validateSources } from '../inventory/sources.js';
import { HINT_RULES, type HintCheck } from '../check/hints.js';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { componentByName, type Inventory } from '../inventory/read.js';
import { RULE_TYPES, type GuidanceRule, type Rule, type RuleLevel, type RuleSet, type RuleType } from './types.js';
import { VISUAL_RULE_IDS } from '../visual/rules.js';

export const BASIC_PACK = 'uxqa:basic';
export const BASIC_VERSION = '1';

/** Default rules applied unless a project switches one off with a reason. */
export const BASIC_RULES: Rule[] = [
  { id: 'basic/use-library-component', type: 'use-library-component', level: 'must', include: [], exclude: [], origin: 'basic',
    fix: '换成组件库里对应的组件' },
  { id: 'basic/no-duplicate-component', type: 'no-duplicate-component', level: 'must', include: [], exclude: [], origin: 'basic',
    fix: '保留组件库里的那一个，删掉另外写的，并把用到它的地方改过去' },
  { id: 'basic/no-hardcoded-color', type: 'no-hardcoded-color', level: 'must', include: [], exclude: [], origin: 'basic',
    fix: '改用项目统一定义的颜色' },
  { id: 'basic/no-arbitrary-size', type: 'no-arbitrary-size', level: 'default', include: [], exclude: [], origin: 'basic',
    fix: '改用项目统一的尺寸档位' },
  { id: 'basic/repeated-pattern', type: 'repeated-pattern', level: 'reference', include: [], exclude: [], origin: 'basic',
    fix: '把反复出现的写法做成组件库里的组件' },
  ...(Object.entries(HINT_RULES) as Array<[HintCheck, (typeof HINT_RULES)[HintCheck]]>).map(([check, hint]): Rule => ({
    id: hint.id, type: 'ui-check', check, level: hint.level, include: [], exclude: [], origin: 'basic',
  })),
];

export class RuleConfigError extends Error {}

const LEVELS = new Set<RuleLevel>(['must', 'default', 'reference', 'off']);

function strings(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) throw new RuleConfigError(`${label} 必须是非空字符串数组`);
  return value as string[];
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new RuleConfigError(`${label} 不能为空`);
  return value;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function readRuleFile(productRoot: string, explicit?: string): Promise<{ path?: string; raw?: Record<string, unknown> }> {
  const path = explicit ? resolve(explicit) : join(productRoot, '.uxqa/rules.json');
  if (!(await exists(path))) {
    if (explicit) throw new RuleConfigError(`找不到规则文件：${explicit}`);
    return {};
  }
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    throw new RuleConfigError(`规则文件不是有效的 JSON：${path}（${error instanceof Error ? error.message : String(error)}）`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RuleConfigError('规则文件的最外层必须是一个对象');
  return { path, raw: raw as Record<string, unknown> };
}

/** Merge the basic pack with project rules. Project rules add new ids or override basic ids; they never silently remove the baseline. */
export function buildRuleSet(raw: Record<string, unknown> | undefined, source?: string): RuleSet {
  const extendsPack = raw?.extends === undefined ? BASIC_PACK : raw.extends;
  if (extendsPack !== BASIC_PACK && extendsPack !== null) throw new RuleConfigError(`extends 只能是 "${BASIC_PACK}" 或 null`);
  const useBasic = extendsPack === BASIC_PACK;
  const rules = new Map<string, Rule>(useBasic ? BASIC_RULES.map((rule) => [rule.id, { ...rule }]) : []);
  const guidance: GuidanceRule[] = [];
  const disabled: RuleSet['disabled'] = [];
  const visual: RuleSet['visual'] = [];
  const entries = raw?.rules === undefined ? [] : raw.rules;
  if (!Array.isArray(entries)) throw new RuleConfigError('rules 必须是数组');
  const library = raw?.library === undefined ? undefined : raw.library;
  if (library !== undefined && (typeof library !== 'object' || library === null || typeof (library as { root?: unknown }).root !== 'string')) throw new RuleConfigError('library 必须写成 { "root": "组件库目录" }');

  for (const [index, entry] of entries.entries()) {
    const where = `第 ${index + 1} 条规则`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new RuleConfigError(`${where}必须是对象`);
    const item = entry as Record<string, unknown>;
    const id = text(item.id, `${where}的 id`);
    const level = (item.level ?? 'default') as RuleLevel;
    if (!LEVELS.has(level)) throw new RuleConfigError(`${where}（${id}）的 level 只能是 must、default、reference 或 off`);
    const reason = item.reason === undefined ? undefined : text(item.reason, `${where}（${id}）的 reason`);

    if (item.type === undefined && typeof item.text === 'string') {
      guidance.push({ id, text: item.text, level });
      continue;
    }
    if (id.startsWith('visual/')) {
      if (!VISUAL_RULE_IDS.includes(id)) throw new RuleConfigError(`没有名为 ${id} 的页面检查规则，可用：${VISUAL_RULE_IDS.join('、')}`);
      if (level === 'off' && !reason) throw new RuleConfigError(`关闭规则 ${id} 时必须写 reason（理由会显示在报告里）`);
      visual.push({ id, level, ...(reason ? { reason } : {}) });
      if (level === 'off') disabled.push({ id, reason: reason! });
      continue;
    }
    const base = rules.get(id);
    if (level === 'off') {
      if (!reason) throw new RuleConfigError(`关闭规则 ${id} 时必须写 reason（理由会显示在报告里）`);
      if (!base) throw new RuleConfigError(`要关闭的规则 ${id} 不存在`);
      // `off` with a scope switches the rule off only there.
      const scope = [...strings(item.scope, `${id} 的 scope`), ...strings(item.exclude, `${id} 的 exclude`)];
      if (!scope.length) { rules.delete(id); disabled.push({ id, reason }); }
      else { rules.set(id, { ...base, exclude: [...base.exclude, ...scope], reason }); disabled.push({ id: `${id}（${scope.join('、')}）`, reason }); }
      continue;
    }
    const type = (item.type ?? base?.type) as RuleType | undefined;
    if (!type) throw new RuleConfigError(`${where}（${id}）缺少 type；如果是一句话规则，请写成 { "id": "...", "text": "..." }`);
    if (!base && !RULE_TYPES.includes(type)) throw new RuleConfigError(`${where}（${id}）的 type "${String(type)}" 不认识，可用：${RULE_TYPES.join('、')}`);
    if (base && item.type !== undefined && item.type !== base.type) throw new RuleConfigError(`${id} 是默认规则，覆盖时不能改它的 type`);
    if (!base && id.startsWith('basic/')) throw new RuleConfigError(`没有名为 ${id} 的默认规则；自定义规则不要以 basic/ 开头`);
    if (base && base.level === 'must' && (level === 'reference' || level === 'default') && !reason) {
      throw new RuleConfigError(`把默认规则 ${id} 从"必须"放宽时要写 reason`);
    }
    const scope = strings(item.scope, `${id} 的 scope`);
    const rule: Rule = {
      ...(base ?? { origin: 'project' as const, include: [], exclude: [] }),
      id, type, level,
      include: item.include !== undefined ? strings(item.include, `${id} 的 include`) : base?.include ?? [],
      exclude: [...(base?.exclude ?? []), ...strings(item.exclude, `${id} 的 exclude`)],
      ...(item.fix === undefined ? {} : { fix: text(item.fix, `${id} 的 fix`) }),
      ...(reason ? { reason } : {}),
      origin: base ? base.origin : 'project',
    };
    if (scope.length) rule.include = scope;
    for (const key of ['element', 'role', 'inputType', 'component', 'module', 'prop'] as const) {
      if (item[key] !== undefined) rule[key] = text(item[key], `${id} 的 ${key}`);
    }
    if (item.components !== undefined) rule.components = strings(item.components, `${id} 的 components`);
    if (item.max !== undefined) {
      if (!Number.isInteger(item.max) || Number(item.max) < 1) throw new RuleConfigError(`${id} 的 max 必须是正整数`);
      rule.max = Number(item.max);
    }
    if (item.minOccurrences !== undefined) {
      if (!Number.isInteger(item.minOccurrences) || Number(item.minOccurrences) < 2) throw new RuleConfigError(`${id} 的 minOccurrences 必须是不小于 2 的整数`);
      rule.minOccurrences = Number(item.minOccurrences);
    }
    if (item.property !== undefined) {
      if (item.property !== 'spacing' && item.property !== 'font-size') throw new RuleConfigError(`${id} 的 property 只能是 spacing 或 font-size`);
      rule.property = item.property;
    }
    if (item.allowed !== undefined) {
      if (item.allowed !== 'multiple-of-4' && !(Array.isArray(item.allowed) && item.allowed.every((value) => typeof value === 'number'))) throw new RuleConfigError(`${id} 的 allowed 只能是 "multiple-of-4" 或数字数组`);
      rule.allowed = item.allowed as Rule['allowed'];
    }
    const required: Partial<Record<RuleType, Array<keyof Rule>>> = {
      'require-library-component': ['element', 'component'], 'forbid-import': ['module'], 'require-prop': ['component', 'prop'],
      'text-length': ['max'], 'value-scale': ['property', 'allowed'],
    };
    for (const key of required[type] ?? []) if (rule[key] === undefined) throw new RuleConfigError(`${id}（${type}）需要填写 ${String(key)}`);
    rules.set(id, rule);
  }
  const libraries = validateSources(raw?.libraries);
  if (libraries.problems.length) throw new RuleConfigError(libraries.problems[0]);
  return {
    extends: useBasic ? BASIC_PACK : undefined,
    libraries: libraries.sources,
    ...(library ? { libraryRoot: (library as { root: string }).root } : {}),
    rules: [...rules.values()], guidance, disabled, visual,
    ...(source ? { source } : {}),
  };
}

/** Rules that name components must name components that exist; a typo is a configuration error, not a silent pass. */
export function validateAgainstInventory(ruleSet: RuleSet, inventory: Inventory): string[] {
  const problems: string[] = [];
  for (const rule of ruleSet.rules) {
    const names = [rule.component, ...(rule.type === 'text-length' ? [] : rule.components ?? [])].filter((name): name is string => !!name);
    for (const name of names) {
      if (!componentByName(inventory, name)) problems.push(`规则 ${rule.id} 提到的组件 ${name} 在组件库（${inventory.library ?? '未找到'}）里不存在`);
    }
  }
  return problems;
}
