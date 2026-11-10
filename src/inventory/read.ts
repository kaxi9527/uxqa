import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { hash } from '../library/paths.js';
import { classifyTag } from '../check/templates/element.js';
import { componentBlocks, componentNameFromFile, markupOf, maskOutside, parseComponentFile, type Framework, type TemplateChild } from '../check/templates/parse.js';
import { COMPONENT_WORDS } from './semantics.js';
import { componentFolder, libraryCacheDir, packageDir, packageName, sourceKind, uxqaHome, validateSources, type LibrarySource } from './sources.js';

export interface LibraryComponent {
  name: string;
  /** Product-relative file path, forward slashes. */
  file: string;
  importPath: string;
  label?: string;
  /** Variant axes, e.g. { variant: ['default','outline'], size: ['sm','lg'] }. */
  variants: Record<string, string[]>;
  defaults: Record<string, string>;
  /** Intrinsic element the component renders, when it can be read statically. */
  renders?: string;
  /** Name of the library source it comes from, when the project lists several (child first, then parents). */
  library?: string;
  /** Class names of each variant option (cva/tv), so hand-written styling can be matched to an option. */
  styles?: { base: string[]; options: Record<string, Record<string, string[]>>; name?: string; file?: string };
}

/** One library source as read for this check. */
export interface LibraryInfo { name: string; kind: 'auto' | 'local' | 'package' | 'git'; display: string; root?: string; importBase?: string; components: number; ready: boolean; issue?: string }

export interface DesignToken {
  name: string;
  value: string;
  kind: 'color' | 'size' | 'other';
  file: string;
}

export interface Inventory {
  productRoot: string;
  libraryRoot?: string;
  /** Product-relative library directory. */
  library?: string;
  source: 'rules' | 'declaration' | 'shadcn' | 'convention' | 'none';
  importBase?: string;
  components: LibraryComponent[];
  tokens: DesignToken[];
  issues: string[];
  hash: string;
  /** Every library source in priority order (the first is the most specific). */
  libraries: LibraryInfo[];
  /** Product-relative folders of all libraries inside the project; code there is library code, not page code. */
  libraryFolders: string[];
  /** Component names defined in more than one library; the earlier (child) library wins. */
  overrides: Array<{ name: string; used: string; hidden: string }>;
}

const CONVENTION_DIRS = ['src/components/ui', 'components/ui', 'src/component-library', 'src/ui', 'src/design-system', 'src/lib/components/ui', 'src/lib/ui', 'packages/ui/src', 'packages/ui'];
const SOURCE_EXT = new Set(['.tsx', '.ts', '.jsx', '.js', '.vue', '.svelte']);
/** shadcn/ui and its Vue / Svelte ports share the components.json format. */
const SHADCN_SCHEMA = /^https:\/\/((ui|www)\.shadcn\.com|(www\.|next\.)?shadcn-vue\.com|(www\.|next\.)?shadcn-svelte\.com)\//;

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

export async function findProductRoot(source: string): Promise<string> {
  const start = await realpath(resolve(source));
  let dir = (await stat(start)).isDirectory() ? start : dirname(start);
  for (;;) {
    if (await exists(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return (await stat(start)).isDirectory() ? start : dirname(start);
    dir = parent;
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    // tsconfig files may contain comments and trailing commas.
    const text = await readFile(path, 'utf8');
    const parsed = ts.parseConfigFileTextToJson(path, text);
    return parsed.config as Record<string, unknown> | undefined;
  } catch { return undefined; }
}

/** Resolve a path alias such as `@/components/ui` using tsconfig `paths`, falling back to the common `@/` → `src/`. */
async function resolveAlias(productRoot: string, alias: string): Promise<string | undefined> {
  for (const file of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    const config = await readJson(join(productRoot, file));
    const options = (config?.compilerOptions ?? {}) as { baseUrl?: string; paths?: Record<string, string[]> };
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      const prefix = pattern.replace(/\*$/, '');
      if (!alias.startsWith(prefix) || !targets?.[0]) continue;
      const target = targets[0].replace(/\*$/, '');
      const candidate = resolve(productRoot, options.baseUrl ?? '.', target + alias.slice(prefix.length));
      if (await exists(candidate)) return candidate;
    }
  }
  if (alias.startsWith('@/')) {
    const candidate = resolve(productRoot, 'src', alias.slice(2));
    if (await exists(candidate)) return candidate;
  }
  // SvelteKit's `$lib` is always src/lib.
  if (alias.startsWith('$lib/') || alias === '$lib') {
    const candidate = resolve(productRoot, 'src/lib', alias.slice(5));
    if (await exists(candidate)) return candidate;
  }
  if (alias.startsWith('~/')) {
    const candidate = resolve(productRoot, alias.slice(2));
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function locateLibrary(productRoot: string, declaredRoot?: string): Promise<{ root?: string; source: Inventory['source']; importBase?: string; cssFiles: string[]; issues: string[] }> {
  const issues: string[] = [];
  const cssFiles: string[] = [];
  const shadcn = await readJson(join(productRoot, 'components.json'));
  const isShadcn = typeof shadcn?.$schema === 'string' && SHADCN_SCHEMA.test(shadcn.$schema as string);
  const aliases = (isShadcn ? shadcn?.aliases : undefined) as { ui?: string; components?: string } | undefined;
  const tailwind = (isShadcn ? shadcn?.tailwind : undefined) as { css?: string } | undefined;
  if (tailwind?.css) cssFiles.push(resolve(productRoot, tailwind.css));

  if (declaredRoot) {
    const root = resolve(productRoot, declaredRoot);
    if (!(await exists(root))) return { source: 'rules', cssFiles, issues: [`声明的组件库目录不存在：${declaredRoot}`] };
    return { root, source: 'rules', importBase: aliases?.ui && (await resolveAlias(productRoot, aliases.ui)) === root ? aliases.ui : undefined, cssFiles, issues };
  }
  const declaration = await readJson(join(productRoot, '.uxqa/library.json'));
  if (typeof declaration?.root === 'string') {
    const root = resolve(productRoot, declaration.root);
    if (await exists(root)) return { root, source: 'declaration', cssFiles, issues };
    issues.push(`.uxqa/library.json 里的组件库目录不存在：${declaration.root}`);
  }
  if (aliases?.ui || aliases?.components) {
    const alias = aliases.ui ?? `${aliases.components}/ui`;
    const root = await resolveAlias(productRoot, alias);
    if (root) return { root, source: 'shadcn', importBase: alias, cssFiles, issues };
    issues.push(`components.json 指向的组件库 ${alias} 无法解析到目录`);
  }
  for (const dir of CONVENTION_DIRS) {
    const root = join(productRoot, dir);
    // In SvelteKit, src/lib is imported as `$lib`.
    if (await exists(root)) return { root, source: 'convention', ...(dir.startsWith('src/lib/') ? { importBase: `$lib/${dir.slice('src/lib/'.length)}` } : {}), cssFiles, issues };
  }
  return { source: 'none', cssFiles, issues };
}

async function listLibraryFiles(root: string, depth = 0, declarations = false): Promise<string[]> {
  if (depth > (declarations ? 4 : 3)) return [];
  const files: string[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listLibraryFiles(path, depth + 1, declarations));
    else if (declarations ? /\.d\.(ts|mts)$/.test(entry.name) : SOURCE_EXT.has(extname(entry.name)) && !/\.(test|spec|stories|d)\.[^.]+$/.test(entry.name)) files.push(path);
    if (files.length > 400) break;
  }
  return files;
}

function scriptKind(file: string): ts.ScriptKind {
  const ext = extname(file);
  return ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.jsx' ? ts.ScriptKind.JSX : ext === '.js' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

export function parseSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function objectProperty(node: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === key) return property.initializer;
  }
  return undefined;
}

/** Read `cva(base, { variants, defaultVariants })` and `tv({ variants })` calls. */
/** Class names written as a string, a template without substitutions, or an array of those. */
function literalClasses(node: ts.Expression | undefined): string[] {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return node.text.split(/\s+/).filter(Boolean);
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) => literalClasses(element as ts.Expression));
  return [];
}

function readVariantCall(call: ts.CallExpression): { variants: Record<string, string[]>; defaults: Record<string, string>; base: string[]; classes: Record<string, Record<string, string[]>> } | undefined {
  const callee = call.expression.getText();
  if (callee !== 'cva' && callee !== 'tv') return undefined;
  const config = [...call.arguments].reverse().find(ts.isObjectLiteralExpression);
  if (!config) return undefined;
  const variants: Record<string, string[]> = {};
  const defaults: Record<string, string> = {};
  const classes: Record<string, Record<string, string[]>> = {};
  // cva("base", {...}); tv({ base: "...", variants })
  const base = call.arguments[0] && !ts.isObjectLiteralExpression(call.arguments[0]) ? literalClasses(call.arguments[0]) : literalClasses(objectProperty(config, 'base'));
  const variantObject = objectProperty(config, 'variants');
  if (variantObject && ts.isObjectLiteralExpression(variantObject)) {
    for (const axis of variantObject.properties) {
      if (!ts.isPropertyAssignment(axis) || !ts.isObjectLiteralExpression(axis.initializer)) continue;
      const axisName = propertyName(axis.name);
      if (!axisName) continue;
      classes[axisName] = {};
      variants[axisName] = axis.initializer.properties.flatMap((option) => {
        const name = option.name && propertyName(option.name as ts.PropertyName);
        if (name && ts.isPropertyAssignment(option)) classes[axisName][name] = literalClasses(option.initializer);
        return name ? [name] : [];
      });
    }
  }
  const defaultObject = objectProperty(config, 'defaultVariants');
  if (defaultObject && ts.isObjectLiteralExpression(defaultObject)) {
    for (const entry of defaultObject.properties) {
      if (ts.isPropertyAssignment(entry) && propertyName(entry.name) && ts.isStringLiteralLike(entry.initializer)) defaults[propertyName(entry.name)!] = entry.initializer.text;
    }
  }
  return Object.keys(variants).length ? { variants, defaults, base, classes } : undefined;
}

/** Read string-literal unions from `interface XProps { variant?: 'a' | 'b' }`. */
function readPropUnions(node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): Record<string, string[]> {
  const members = ts.isInterfaceDeclaration(node) ? node.members : ts.isTypeLiteralNode(node.type) ? node.type.members : [];
  const result: Record<string, string[]> = {};
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
    const name = propertyName(member.name);
    if (!name || !ts.isUnionTypeNode(member.type)) continue;
    const options = member.type.types.flatMap((type) => ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal) ? [type.literal.text] : []);
    if (options.length >= 2) result[name] = options;
  }
  return result;
}

const INTRINSIC = /^[a-z][a-z0-9]*$/;
const HTML_TAGS = new Set('a abbr article aside button details dialog div fieldset footer form h1 h2 h3 h4 h5 h6 header hr img input label li main nav ol option output p progress section select span summary table tbody td textarea th thead tr ul'.split(' '));

function firstIntrinsic(node: ts.Node): string | undefined {
  let found: string | undefined;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) && ts.isIdentifier(child.tagName) && INTRINSIC.test(child.tagName.text)) { found = child.tagName.text; return; }
    // `const Comp = asChild ? Slot : "button"`
    if (ts.isConditionalExpression(child) && ts.isIdentifier(child.whenTrue) && ts.isStringLiteral(child.whenFalse) && HTML_TAGS.has(child.whenFalse.text)) { found = child.whenFalse.text; return; }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function labelFor(name: string, file: string): string | undefined {
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const candidates = [kebab, basename(file, extname(file)).toLowerCase()];
  const parts = kebab.split('-');
  for (let length = parts.length - 1; length > 0; length--) candidates.push(parts.slice(0, length).join('-'));
  for (const key of candidates) if (COMPONENT_WORDS[key]) return COMPONENT_WORDS[key].label;
  return undefined;
}

function readComponents(file: string, relFile: string, importPath: string, source: ts.SourceFile): LibraryComponent[] {
  const exported = new Set<string>();
  const declarations = new Map<string, ts.Node>();
  const variantCalls = new Map<string, NonNullable<ReturnType<typeof readVariantCall>>>();
  const propUnions = new Map<string, Record<string, string[]>>();
  const isExported = (node: ts.Node) => !!(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exported.add(element.name.text);
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
      if (isExported(statement)) exported.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        declarations.set(declaration.name.text, declaration);
        if (isExported(statement)) exported.add(declaration.name.text);
        if (declaration.initializer && ts.isCallExpression(declaration.initializer)) {
          const variants = readVariantCall(declaration.initializer);
          if (variants) variantCalls.set(declaration.name.text, variants);
        }
      }
    }
    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name.text.endsWith('Props')) {
      const unions = readPropUnions(statement);
      if (Object.keys(unions).length) propUnions.set(statement.name.text.slice(0, -'Props'.length), unions);
    }
  }

  const names = [...exported].filter(isComponentName);
  return names.map((name) => {
    const lower = name.charAt(0).toLowerCase() + name.slice(1);
    const call = variantCalls.get(`${lower}Variants`) ?? (names.length === 1 && variantCalls.size === 1 ? [...variantCalls.values()][0] : undefined);
    const unions = propUnions.get(name) ?? {};
    const declaration = declarations.get(name);
    return {
      name, file: relFile, importPath,
      ...(labelFor(name, file) ? { label: labelFor(name, file) } : {}),
      variants: { ...unions, ...(call?.variants ?? {}) },
      defaults: call?.defaults ?? {},
      ...(call ? { styles: { base: call.base, options: call.classes, ...(call === variantCalls.get(`${lower}Variants`) ? { name: `${lower}Variants` } : {}) } } : {}),
      ...(declaration && firstIntrinsic(declaration) ? { renders: firstIntrinsic(declaration) } : {}),
    };
  });
}

/** String-literal options of a type: `'a' | 'b'`, or a type alias in the same file that is one. */
function literalOptions(type: ts.TypeNode | undefined, aliases: Map<string, ts.TypeNode>, depth = 0): string[] {
  if (!type || depth > 3) return [];
  if (ts.isUnionTypeNode(type)) return type.types.flatMap((member) => literalOptions(member, aliases, depth + 1));
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) return [type.literal.text];
  if (ts.isParenthesizedTypeNode(type)) return literalOptions(type.type, aliases, depth + 1);
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    // `String as PropType<'a' | 'b'>`
    if (type.typeName.text === 'PropType') return literalOptions(type.typeArguments?.[0], aliases, depth + 1);
    return literalOptions(aliases.get(type.typeName.text), aliases, depth + 1);
  }
  return [];
}

/** Property signatures of a props type: a type literal, a local interface / type alias, or an intersection of those. */
function propMembers(type: ts.TypeNode | undefined, aliases: Map<string, ts.TypeNode>, interfaces: Map<string, ts.InterfaceDeclaration>, depth = 0): ts.PropertySignature[] {
  if (!type || depth > 3) return [];
  if (ts.isTypeLiteralNode(type)) return type.members.filter(ts.isPropertySignature);
  if (ts.isIntersectionTypeNode(type)) return type.types.flatMap((member) => propMembers(member, aliases, interfaces, depth + 1));
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const declared = interfaces.get(type.typeName.text);
    if (declared) return declared.members.filter(ts.isPropertySignature);
    return propMembers(aliases.get(type.typeName.text), aliases, interfaces, depth + 1);
  }
  return [];
}

/**
 * Style options of a Vue / Svelte component, read from its props: Vue `defineProps<{ variant?: 'a' | 'b' }>()`,
 * `defineProps({ variant: { type: String as PropType<…>, default, validator } })`, `withDefaults(…)`, `props: {…}`;
 * Svelte `export let variant: 'a' | 'b' = 'a'` and `let { variant = 'a' }: Props = $props()`.
 */
function readSfcProps(source: ts.SourceFile): { variants: Record<string, string[]>; defaults: Record<string, string> } {
  const aliases = new Map<string, ts.TypeNode>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const variants: Record<string, string[]> = {};
  const defaults: Record<string, string> = {};
  const addOptions = (name: string | undefined, options: string[]) => { if (name && new Set(options).size >= 2) variants[name] = [...new Set(options)]; };
  const addDefault = (name: string | undefined, value: ts.Node | undefined) => { if (name && value && ts.isStringLiteralLike(value)) defaults[name] = value.text; };
  const collect = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node.type);
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
    ts.forEachChild(node, collect);
  };
  collect(source);
  const fromType = (type: ts.TypeNode | undefined) => {
    for (const member of propMembers(type, aliases, interfaces)) addOptions(member.name && propertyName(member.name), literalOptions(member.type, aliases));
  };
  const fromRuntime = (object: ts.ObjectLiteralExpression) => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property.name);
      const options = property.initializer;
      if (!ts.isObjectLiteralExpression(options)) continue;
      const type = objectProperty(options, 'type');
      if (type && ts.isAsExpression(type)) addOptions(name, literalOptions(type.type, aliases));
      const validator = objectProperty(options, 'validator');
      if (validator && !variants[name ?? '']) {
        let list: string[] = [];
        const find = (child: ts.Node): void => { if (!list.length && ts.isArrayLiteralExpression(child) && child.elements.every(ts.isStringLiteralLike)) list = child.elements.map((element) => (element as ts.StringLiteralLike).text); else ts.forEachChild(child, find); };
        find(validator);
        addOptions(name, list);
      }
      addDefault(name, objectProperty(options, 'default'));
    }
  };
  const fromPattern = (pattern: ts.BindingName) => {
    if (!ts.isObjectBindingPattern(pattern)) return;
    for (const element of pattern.elements) {
      const name = element.propertyName ? propertyName(element.propertyName) : ts.isIdentifier(element.name) ? element.name.text : undefined;
      addDefault(name, element.initializer);
    }
  };
  const isCall = (node: ts.Node, name: string): node is ts.CallExpression => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
  const visit = (node: ts.Node): void => {
    if (isCall(node, 'defineProps')) {
      fromType(node.typeArguments?.[0]);
      if (node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) fromRuntime(node.arguments[0]);
    }
    if (isCall(node, 'withDefaults') && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      for (const property of node.arguments[1].properties) if (ts.isPropertyAssignment(property)) addDefault(propertyName(property.name), property.initializer);
    }
    // Options API: `export default { props: {…} }` / `defineComponent({ props: {…} })`.
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'props' && ts.isObjectLiteralExpression(node.initializer)
      && (ts.isExportAssignment(node.parent.parent) || (ts.isCallExpression(node.parent.parent) && node.parent.parent.expression.getText(source) === 'defineComponent'))) fromRuntime(node.initializer);
    if (ts.isVariableDeclaration(node) && node.initializer) {
      // Vue 3.5 `const { variant = 'default' } = defineProps<…>()`, Svelte 5 `let { variant = 'default' }: Props = $props()`.
      if (isCall(node.initializer, 'defineProps') || isCall(node.initializer, '$props')) fromPattern(node.name);
      if (isCall(node.initializer, '$props')) fromType(node.type);
    }
    // Svelte 4 `export let variant: 'default' | 'outline' = 'default'`.
    if (ts.isVariableStatement(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        addOptions(declaration.name.text, literalOptions(declaration.type, aliases));
        addDefault(declaration.name.text, declaration.initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const name of Object.keys(defaults)) if (!variants[name]) delete defaults[name];
  return { variants, defaults };
}

function firstIntrinsicTag(children: TemplateChild[], framework: Framework): string | undefined {
  for (const child of children) {
    if (child.type !== 'element' || child.content) continue;
    const { role } = classifyTag(child.tag, framework);
    if (role === 'intrinsic') return child.tag;
    if (role === 'component') return undefined;
    const inner = firstIntrinsicTag(child.children, framework);
    if (inner) return inner;
  }
  return undefined;
}

/** A `.vue` / `.svelte` file is one component, named after the file. */
function readComponentFile(file: string, relFile: string, importPath: string, text: string): LibraryComponent[] {
  const name = componentNameFromFile(file);
  if (!name) return [];
  const framework: Framework = file.endsWith('.vue') ? 'vue' : 'svelte';
  const root = parseComponentFile(text, framework);
  const { scripts } = componentBlocks(root);
  const lang = scripts.some((script) => script.lang === 'tsx') ? 'tsx' : scripts.some((script) => script.lang === 'ts') ? 'ts' : 'js';
  const source = parseSource(`component.${lang}`, maskOutside(text, scripts));
  const props = readSfcProps(source);
  const calls: Array<NonNullable<ReturnType<typeof readVariantCall>> & { variable: string }> = [];
  const findCalls = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const variants = readVariantCall(node.initializer);
      if (variants) calls.push({ ...variants, variable: node.name.text });
    }
    ts.forEachChild(node, findCalls);
  };
  findCalls(source);
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  const call = calls.find((entry) => entry.variable === `${lower}Variants`) ?? (calls.length === 1 ? calls[0] : undefined);
  const renders = firstIntrinsicTag(markupOf(root, framework), framework);
  return [{
    name, file: relFile, importPath,
    ...(labelFor(name, file) ? { label: labelFor(name, file) } : {}),
    variants: { ...props.variants, ...(call?.variants ?? {}) },
    defaults: { ...props.defaults, ...(call?.defaults ?? {}) },
    ...(call ? { styles: { base: call.base, options: call.classes, ...(call.variable === `${lower}Variants` ? { name: call.variable } : {}) } } : {}),
    ...(renders ? { renders } : {}),
  }];
}

/**
 * shadcn-vue / shadcn-svelte keep a component in `button/Button.vue` and export it (with its cva variants) from
 * `button/index.ts`: that is one component, imported from the folder.
 */
function mergeFolderExports(components: LibraryComponent[]): LibraryComponent[] {
  const result: LibraryComponent[] = [];
  const merged = new Set<LibraryComponent>();
  for (const component of components) {
    if (!/\.(vue|svelte)$/.test(component.file)) continue;
    const folder = dirname(component.file);
    const index = components.find((entry) => entry.name === component.name && /(^|\/)index\.(ts|js)$/.test(entry.file) && dirname(entry.file) === folder);
    if (!index) continue;
    merged.add(index);
    Object.assign(component, {
      importPath: index.importPath,
      variants: { ...component.variants, ...index.variants },
      defaults: { ...component.defaults, ...index.defaults },
      // The options are edited where they are written (index.ts), not in the .vue / .svelte file.
      ...(index.styles ? { styles: { ...index.styles, file: index.file } } : component.styles ? { styles: component.styles } : {}),
    });
  }
  for (const component of components) if (!merged.has(component)) result.push(component);
  return result;
}

function tokenKind(name: string, value: string): DesignToken['kind'] {
  if (/^(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color-mix\()/i.test(value) || /^color-/.test(name)) return 'color';
  if (/^-?\d*\.?\d+(px|rem|em)$/.test(value) || /^(spacing|radius|size|text-size|font-size)/.test(name)) return 'size';
  return 'other';
}

async function readTokens(productRoot: string, cssFiles: string[], libraryRoot?: string): Promise<DesignToken[]> {
  const candidates = new Set(cssFiles);
  for (const dir of ['src', 'app', 'styles', 'src/styles', 'src/assets', 'assets', 'assets/css']) {
    const path = join(productRoot, dir);
    if (!(await exists(path))) continue;
    for (const entry of await readdir(path)) if (entry.endsWith('.css')) candidates.add(join(path, entry));
  }
  if (libraryRoot) for (const entry of await readdir(libraryRoot).catch(() => [] as string[])) if (entry.endsWith('.css')) candidates.add(join(libraryRoot, entry));
  const tokens = new Map<string, DesignToken>();
  for (const file of candidates) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (text.length > 1_000_000) continue;
    for (const match of text.matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);/g)) {
      const [, name, raw] = match;
      if (tokens.has(name)) continue;
      const value = raw.trim();
      tokens.set(name, { name, value, kind: tokenKind(name, value), file: toPosix(relative(productRoot, file)) });
      if (tokens.size > 2000) break;
    }
  }
  return [...tokens.values()];
}

/** Library settings written in .uxqa/rules.json (read here directly so every entry point sees the same libraries). */
async function declaredLibraries(productRoot: string): Promise<{ root?: string; libraries: LibrarySource[]; problems: string[] }> {
  const raw = await readJson(join(productRoot, '.uxqa/rules.json'));
  const library = raw?.library as { root?: unknown } | undefined;
  const { sources, problems } = validateSources(raw?.libraries);
  return { ...(typeof library?.root === 'string' ? { root: library.root } : {}), libraries: sources, problems };
}

async function readLibrary(productRoot: string, root: string, display: string, importFor: (file: string) => string, library: string | undefined, declarations: boolean, digest: string[]): Promise<LibraryComponent[]> {
  const components: LibraryComponent[] = [];
  const inside = !relative(productRoot, root).startsWith('..');
  for (const file of await listLibraryFiles(root, 0, declarations)) {
    const text = await readFile(file, 'utf8');
    if (text.length > 512_000) continue;
    digest.push(`${file}:${hash(text)}`);
    const relFile = inside ? toPosix(relative(productRoot, file)) : `${display}/${toPosix(relative(root, file))}`;
    const found = /\.(vue|svelte)$/.test(file) ? readComponentFile(file, relFile, importFor(file), text) : readComponents(file, relFile, importFor(file), parseSource(file, text));
    components.push(...found.map((component) => (library ? { ...component, library } : component)));
  }
  return mergeFolderExports(components);
}

export async function readInventory(source: string, declared?: string | { root?: string; libraries?: LibrarySource[] }): Promise<Inventory> {
  const productRoot = await findProductRoot(source);
  const fromFile = declared === undefined ? await declaredLibraries(productRoot) : undefined;
  const declaredRoot = typeof declared === 'string' ? declared : declared ? declared.root : fromFile?.root;
  const sources = typeof declared === 'object' ? declared.libraries ?? [] : fromFile?.libraries ?? [];
  const located = await locateLibrary(productRoot, declaredRoot);
  const issues = [...located.issues, ...(fromFile?.problems ?? [])];
  const digest: string[] = [];
  const libraries: LibraryInfo[] = [];
  let components: LibraryComponent[] = [];
  const several = sources.length > 0;

  // The project's own library (found automatically or declared) is always the most specific one.
  if (located.root) {
    const name = several ? '本项目组件库' : undefined;
    const found = await readLibrary(productRoot, located.root, toPosix(relative(productRoot, located.root)), (file) => {
      const relToLib = toPosix(relative(located.root!, file)).replace(/\.(tsx|ts|jsx|js)$/, '').replace(/\/index$/, '');
      return located.importBase ? `${located.importBase}/${relToLib}` : `./${toPosix(relative(productRoot, file)).replace(/\.(tsx|ts|jsx|js)$/, '')}`;
    }, name, false, digest);
    components.push(...found);
    libraries.push({ name: name ?? '组件库', kind: 'auto', display: toPosix(relative(productRoot, located.root)), root: located.root, ...(located.importBase ? { importBase: located.importBase } : {}), components: found.length, ready: true });
  }
  for (const entry of sources) {
    const kind = sourceKind(entry);
    let root: string | undefined;
    let declarations = false;
    let importBase = entry.import;
    let issue: string | undefined;
    let display = entry.root ?? entry.package ?? entry.git ?? entry.name;
    if (kind === 'local') {
      root = resolve(productRoot, entry.root!);
      if (located.root && root === located.root) continue; // same folder as the project's own library
      if (!(await access(root).then(() => true, () => false))) { issue = `文件夹不存在：${entry.root}`; root = undefined; }
      else importBase ??= await packageName(root);
    } else if (kind === 'package') {
      const dir = await packageDir(productRoot, entry.package!);
      if (!dir) issue = `项目里还没装 ${entry.package}（在项目里运行安装依赖的命令后再检测）`;
      else { const folder = await componentFolder(dir, entry.path); root = folder.dir; declarations = folder.declarations; importBase ??= entry.package; display = entry.package!; }
    } else {
      const dir = libraryCacheDir(uxqaHome(), entry.git!);
      if (!(await access(join(dir, '.git')).then(() => true, () => false))) issue = '还没拉取：在控制台"组件库"里点"拉取"';
      else { root = entry.path ? resolve(dir, entry.path) : (await componentFolder(dir)).dir; importBase ??= await packageName(dir); display = entry.git!.replace(/^https?:\/\//, '').replace(/\.git$/, ''); }
    }
    const found = root ? await readLibrary(productRoot, root, display, (file) => importBase ?? `./${toPosix(relative(productRoot, file)).replace(/\.(d\.)?(tsx|ts|jsx|js|mts)$/, '')}`, entry.name, declarations, digest) : [];
    if (root && !found.length && !issue) issue = '这里没读到组件（检查目录是否指对了）';
    components.push(...found);
    libraries.push({ name: entry.name, kind, display, ...(root ? { root } : {}), ...(importBase ? { importBase } : {}), components: found.length, ready: !!root, ...(issue ? { issue } : {}) });
    if (issue) issues.push(`组件库来源「${entry.name}」：${issue}`);
  }

  // A name in several libraries: the first (most specific) one is used.
  const overrides: Inventory['overrides'] = [];
  if (several) {
    const first = new Map<string, LibraryComponent>();
    const kept: LibraryComponent[] = [];
    for (const component of components) {
      const winner = first.get(component.name);
      if (winner && winner.library !== component.library) { if (!overrides.some((entry) => entry.name === component.name)) overrides.push({ name: component.name, used: winner.library ?? '', hidden: component.library ?? '' }); continue; }
      if (!winner) first.set(component.name, component);
      kept.push(component);
    }
    components = kept;
  }

  const tokens = await readTokens(productRoot, located.cssFiles, located.root);
  const libraryFolders = libraries.flatMap((library) => (library.root && !relative(productRoot, library.root).startsWith('..') ? [toPosix(relative(productRoot, library.root))] : []));
  return {
    productRoot,
    ...(located.root ? { libraryRoot: located.root, library: toPosix(relative(productRoot, located.root)) } : {}),
    source: located.source,
    ...(located.importBase ? { importBase: located.importBase } : {}),
    components, tokens, issues,
    hash: hash(digest.join('\n')),
    libraries, libraryFolders, overrides,
  };
}

/** How to name "the component library" to people: the project's own folder, or the configured sources. */
export function libraryLabel(inventory: Inventory): string | undefined {
  const usable = inventory.libraries.filter((library) => library.components > 0);
  if (!usable.length) return inventory.library;
  if (usable.length === 1) return inventory.library ?? `${usable[0].name}（${usable[0].display}）`;
  return usable.map((library) => `${library.name}（${library.display}）`).join(' + ');
}

/** Find a library component by export name, case-insensitively. */
export function componentByName(inventory: Inventory, name: string): LibraryComponent | undefined {
  const matches = inventory.components.filter((component) => component.name === name);
  const pool = matches.length ? matches : inventory.components.filter((component) => component.name.toLowerCase() === name.toLowerCase());
  // Prefer the file named after the component (ui/button.tsx over a compatibility shim exporting Button).
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return pool.find((component) => basename(component.file, extname(component.file)).toLowerCase() === kebab)
    ?? pool.find((component) => kebab.startsWith(basename(component.file, extname(component.file)).toLowerCase()))
    ?? pool[0];
}
