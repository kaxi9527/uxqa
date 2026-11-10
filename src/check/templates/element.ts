import { pascalTag, type Framework, type TemplateAttribute, type TemplateChild, type TemplateElement } from './parse.js';

/**
 * What one template element is, read the way the JSX scanner reads a JSX element: its tag, its attributes that
 * have a readable value, its static class names and its own text. Anything bound to data is reported as dynamic
 * instead of being guessed.
 */
export interface ElementView {
  element: TemplateElement;
  /** Lower-case HTML tag, or the component name in PascalCase (`<my-card>` → `MyCard`). */
  tag: string;
  role: 'intrinsic' | 'component' | 'transparent' | 'skip';
  has(name: string): boolean;
  /** A value that is written out: `alt="x"`, `:tabindex="2"`, `alt={"x"}`. */
  literal(name: string): string | undefined;
  /** Present, but bound to data (`:role="r"`, `href="/u/{id}"`). */
  dynamic(name: string): boolean;
  event(name: string): boolean;
  spread: boolean;
  /** Attribute / prop names as a component receives them. */
  names: string[];
  /** Static class names, each with its file offset. */
  classTokens: Array<{ token: string; offset: number }>;
  classes: string[];
  /** False when part of the class list is bound to data (`:class`, `class:x`, `class="a {b}"`). */
  classesComplete: boolean;
  /** All static text directly inside (like JSX text children), or undefined. */
  text?: string;
}

const VUE_TRANSPARENT = /^(template|transition|transition-group|TransitionGroup|Transition|keep-alive|KeepAlive|teleport|Teleport|suspense|Suspense)$/;
const VUE_SKIP = /^(slot|component|Component|Slot)$/;
const INTRINSIC = /^[a-z][a-z0-9]*$/;

function literalOf(expression: string): string | undefined {
  const code = expression.trim();
  const quoted = code.match(/^(['"`])((?:\\.|(?!\1)[^\\])*)\1$/);
  if (quoted && !(quoted[1] === '`' && quoted[2].includes('${'))) return quoted[2];
  if (/^-?\d+(\.\d+)?$/.test(code)) return code;
  return undefined;
}

export function classifyTag(tag: string, framework: Framework): { tag: string; role: ElementView['role'] } {
  if (framework === 'vue') {
    if (VUE_TRANSPARENT.test(tag)) return { tag, role: 'transparent' };
    if (VUE_SKIP.test(tag)) return { tag, role: 'skip' };
    if (INTRINSIC.test(tag)) return { tag, role: 'intrinsic' };
    if (/^[A-Z]/.test(tag) || tag.includes('-')) return { tag: pascalTag(tag), role: 'component' };
    return { tag, role: 'skip' };
  }
  if (tag === 'svelte:fragment') return { tag, role: 'transparent' };
  if (tag.includes(':') || tag === 'slot') return { tag, role: 'skip' };
  if (INTRINSIC.test(tag)) return { tag, role: 'intrinsic' };
  if (/^[A-Z]/.test(tag)) return { tag, role: 'component' };
  // Lower-case names with a dash are custom elements, not Svelte components.
  return { tag, role: 'skip' };
}

/** Static parts of an attribute value, with Svelte `{expr}` parts cut out. */
function staticSegments(attribute: TemplateAttribute): Array<{ text: string; offset: number; touchesStart: boolean; touchesEnd: boolean }> {
  const value = attribute.value ?? '';
  const start = attribute.valueStart ?? attribute.start;
  if (!attribute.mixed) return [{ text: value, offset: start, touchesStart: false, touchesEnd: false }];
  const segments: Array<{ text: string; offset: number; touchesStart: boolean; touchesEnd: boolean }> = [];
  let index = 0;
  let segmentStart = 0;
  while (index <= value.length) {
    if (index === value.length || value[index] === '{') {
      segments.push({ text: value.slice(segmentStart, index), offset: start + segmentStart, touchesStart: segmentStart > 0, touchesEnd: index < value.length });
      if (index === value.length) break;
      let depth = 0;
      for (; index < value.length; index++) {
        if (value[index] === '{') depth++;
        else if (value[index] === '}' && --depth === 0) break;
      }
      index++;
      segmentStart = index;
      continue;
    }
    index++;
  }
  return segments;
}

/** Expressions inside an attribute value: the whole value when bound, the `{…}` parts of a mixed Svelte value. */
export function expressionsOf(attribute: TemplateAttribute): Array<{ code: string; offset: number }> {
  if (attribute.value === undefined || attribute.valueStart === undefined) return [];
  if (attribute.kind === 'bound') return [{ code: attribute.value, offset: attribute.valueStart }];
  if (!attribute.mixed) return [];
  const result: Array<{ code: string; offset: number }> = [];
  const value = attribute.value;
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '{') continue;
    let depth = 0;
    let end = index;
    for (; end < value.length; end++) {
      if (value[end] === '{') depth++;
      else if (value[end] === '}' && --depth === 0) break;
    }
    result.push({ code: value.slice(index + 1, end), offset: attribute.valueStart + index + 1 });
    index = end;
  }
  return result;
}

/** Class tokens in a static (part of a) value, dropping tokens glued to an expression (`btn-{size}`). */
export function tokensOf(attribute: TemplateAttribute): Array<{ token: string; offset: number }> {
  const tokens: Array<{ token: string; offset: number }> = [];
  for (const segment of staticSegments(attribute)) {
    const found = [...segment.text.matchAll(/\S+/g)];
    found.forEach((match, position) => {
      const index = match.index ?? 0;
      if (position === 0 && segment.touchesStart && index === 0) return;
      if (position === found.length - 1 && segment.touchesEnd && index + match[0].length === segment.text.length) return;
      tokens.push({ token: match[0], offset: segment.offset + index });
    });
  }
  return tokens;
}

export function ownText(children: TemplateChild[]): string | undefined {
  const text = children.flatMap((child) => (child.type === 'text' ? [child.text] : [])).join(' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

/**
 * `fallthrough`: a Vue component's root element also receives every attribute the parent passes
 * (`<Input id="x" />` puts `id` on the root `<input>`), like an implicit `{...props}`.
 */
export function viewOf(element: TemplateElement, framework: Framework, fallthrough = false): ElementView {
  const { tag, role } = classifyTag(element.tag, framework);
  const intrinsic = role === 'intrinsic';
  const key = (name: string) => (intrinsic ? name.toLowerCase() : name);
  const valued = element.attributes.filter((attribute) => attribute.kind === 'static' || attribute.kind === 'bound');
  const find = (name: string) => valued.find((attribute) => key(attribute.name) === key(name));
  const literal = (name: string) => {
    const attribute = find(name);
    if (!attribute || attribute.value === undefined) return undefined;
    if (attribute.kind === 'static') return attribute.mixed ? undefined : attribute.value;
    return literalOf(attribute.value);
  };
  const classAttributes = element.attributes.filter((attribute) => attribute.name === 'class' && (attribute.kind === 'static' || attribute.kind === 'bound'));
  const classTokens = classAttributes.filter((attribute) => attribute.kind === 'static').flatMap(tokensOf);
  const classesComplete = !fallthrough && !element.attributes.some((attribute) => (attribute.name === 'class' && (attribute.kind === 'bound' || attribute.mixed)) || attribute.kind === 'class-directive' || attribute.kind === 'spread');
  const names = element.attributes.flatMap((attribute) => {
    if (attribute.kind === 'spread') return ['{...}'];
    if (attribute.kind === 'event') return [`on${attribute.name[0]?.toUpperCase() ?? ''}${attribute.name.slice(1)}`];
    if (attribute.kind === 'directive') return attribute.name.startsWith('v-model') ? [attribute.name.includes(':') ? attribute.name.split(':')[1] : 'modelValue'] : [];
    if (attribute.kind === 'static' || attribute.kind === 'bound') {
      const camel = attribute.name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return camel === attribute.name ? [attribute.name] : [attribute.name, camel];
    }
    return [];
  });
  // Text inside Svelte `{#if}` blocks is several alternatives, not one label.
  const text = element.blocks ? undefined : ownText(element.children);
  return {
    element, tag, role,
    has: (name) => !!find(name),
    literal,
    dynamic: (name) => !!find(name) && literal(name) === undefined && find(name)!.value !== undefined,
    event: (name) => element.attributes.some((attribute) => attribute.kind === 'event' && attribute.name.toLowerCase() === name),
    spread: fallthrough || element.attributes.some((attribute) => attribute.kind === 'spread'),
    names,
    classTokens,
    classes: [...new Set(classTokens.map((entry) => entry.token))].sort(),
    classesComplete,
    ...(text ? { text } : {}),
  };
}
