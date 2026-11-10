import type { LibraryComponent } from '../inventory/read.js';

/**
 * Hand-written styling vs a library component's style options (cva / tv variants).
 * Picks the closest option on every axis, and lists the styling no option provides. That turns
 * "use the library" into an exact instruction (<Button variant="outline" size="sm">), or, when the library
 * really lacks it, a proposal to add one option to the library instead of styling the page by hand.
 */
export interface VariantMatch { props: Record<string, string>; leftover: string[]; tweaks: string[]; axis?: string; file: string; styleName?: string }

const TEXT_SIZE = /^text-(xs|sm|base|lg|[2-9]?xl|\[\d)/;
/** Small adjustments that can stay in className on the library component. */
const MINOR = /(^|:)(rounded|text-align|truncate|w|min-w|max-w|m|mx|my|mt|mb|ml|mr|self|justify|items|cursor|select|whitespace|underline-offset)$/;
/** Styling that makes a different-looking component: colour, size, border, shadow. */
const MAJOR = /(^|:)(bg|text-color|text-size|border|h|px|py|p|shadow|ring|font)$/;

/** "hover:bg-primary/90" → "hover:bg"; "text-sm" → "text-size"; "text-white" → "text-color". */
export function family(name: string): string {
  const parts = name.replace(/^!/, '').split(':');
  const utility = parts.pop()!.replace(/^-/, '');
  const prefix = parts.length ? `${parts.join(':')}:` : '';
  if (/^text-(left|center|right|justify|start|end)$/.test(utility)) return `${prefix}text-align`;
  if (utility.startsWith('text-')) return `${prefix}${TEXT_SIZE.test(utility) ? 'text-size' : 'text-color'}`;
  const root = utility.match(/^(min-w|max-w|min-h|max-h|gap-x|gap-y|space-x|space-y|rounded|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|[a-z]+)/)?.[1] ?? utility;
  return `${prefix}${root}`;
}

export function matchVariants(component: LibraryComponent, classes: string[]): VariantMatch | undefined {
  const styles = component.styles;
  if (!styles || !Object.keys(styles.options).length || !classes.length) return undefined;
  const optionClasses = Object.values(styles.options).flatMap((options) => Object.values(options).flat());
  // Only styling the component itself decides (colour, size, border, radius…); layout like margins stays in className.
  const styleFamilies = new Set([...styles.base, ...optionClasses].map(family));
  const base = new Set(styles.base);
  const relevant = classes.filter((name) => styleFamilies.has(family(name)) && !MINOR.test(family(name)) && !base.has(name));
  // Without readable styling there is nothing to compare; the caller falls back to the plain advice.
  if (!relevant.length) return undefined;
  const mine = new Set(relevant.map(family));
  const props: Record<string, string> = {};
  const covered = new Set(styles.base);
  for (const [axis, options] of Object.entries(styles.options)) {
    const fallback = component.defaults[axis] ?? Object.keys(options)[0];
    // Only the resting look counts (hover:/active:/focus: states would drown it). Same class +1, same kind of
    // styling +0.5; styling the original does not have −0.5, or −1 for a background, border or text colour it lacks.
    const score = (list: string[]) => list.filter((name) => !name.includes(':')).reduce((sum, name) => {
      if (relevant.includes(name)) return sum + 1;
      if (mine.has(family(name))) return sum + 0.5;
      return sum - (/^(bg|border|text-color)$/.test(family(name)) ? 1 : 0.5);
    }, 0);
    let best = fallback;
    let bestScore = score(options[fallback] ?? []);
    for (const [option, list] of Object.entries(options)) {
      const value = score(list);
      if (value > bestScore) { best = option; bestScore = value; }
    }
    for (const name of options[best] ?? []) covered.add(name);
    if (best !== component.defaults[axis]) props[axis] = best;
  }
  // Colour/size/border styling no option provides (a different value of something an option sets counts too: bg-blue vs bg-primary).
  const leftover = relevant.filter((name) => !covered.has(name) && MAJOR.test(family(name)));
  // Small adjustments are fine as className on the library component.
  const tweaks = classes.filter((name) => MINOR.test(family(name)) && !covered.has(name));
  // The axis whose options style the same things the leftovers do is where a new option belongs.
  const leftoverFamilies = new Set(leftover.map(family));
  let axis: string | undefined;
  let axisScore = -1;
  for (const [name, options] of Object.entries(styles.options)) {
    const score = Object.values(options).flat().filter((entry) => leftoverFamilies.has(family(entry))).length;
    if (score > axisScore) { axis = name; axisScore = score; }
  }
  return { props, leftover, tweaks, ...(axis ? { axis } : {}), file: styles.file ?? component.file, ...(styles.name ? { styleName: styles.name } : {}) };
}

export function jsxFor(component: LibraryComponent, props: Record<string, string>): string {
  const attributes = Object.entries(props).map(([key, value]) => ` ${key}="${value}"`).join('');
  return `<${component.name}${attributes}>`;
}

/** Plain instruction for the AI: the exact options to use, or the one option to add to the library. */
export function variantAdvice(component: LibraryComponent, match: VariantMatch, libraryName?: string): string {
  const where = libraryName ? `组件库「${libraryName}」` : '组件库';
  const closest = jsxFor(component, match.props);
  const tweak = match.tweaks.length ? `，${match.tweaks.join(' ')} 这类小调整写在它的 ${/\.(vue|svelte)$/.test(component.file) ? 'class' : 'className'} 上` : '';
  if (!match.leftover.length) return `换成${where}里的 ${closest}${tweak}（颜色和尺寸用现有的样式选项就行）。`;
  const proposed = 'custom';
  const axis = match.axis ?? 'variant';
  return [
    `${where}里最接近的是 ${closest}，但这里还多了这些样式：${match.leftover.join(' ')}。`,
    `先确认现有选项（${Object.entries(component.styles!.options).map(([name, options]) => `${name}: ${Object.keys(options).join('/')}`).join('；')}）能不能满足设计；`,
    `不能的话，不要在页面里手写样式，而是在 ${match.file}${match.styleName ? ` 的 ${match.styleName}` : ''} 里给 ${axis} 加一个新选项（起一个能说明用途的名字代替 "${proposed}"，样式先用 "${match.leftover.join(' ')}"），再在这里写 ${jsxFor(component, { ...match.props, [axis]: proposed })}。`,
  ].join('');
}
