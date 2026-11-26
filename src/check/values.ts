/** Value patterns shared by the JSX scanner and the Vue / Svelte template scanner. */

export const COLOR_VALUE = /^(#[0-9a-fA-F]{3,8}|rgba?\(.+\)|hsla?\(.+\)|oklch\(.+\))$/;
export const SIZE_VALUE = /^(-?\d*\.?\d+)(px|rem|em)$/;
// Tailwind arbitrary values such as `bg-[#123456]`, `px-[13px]`, `md:text-[15px]`.
export const ARBITRARY = /(?<![\w-])((?:[a-z0-9-]+:)*)(-?[a-z][a-z0-9-]*)-\[([^\]\s]+)\]/g;

// Breakpoint and selector variants describe where the utility applies. Only its final segment sets a value.
export function* arbitraryUtilities(value:string){
  for(const token of value.matchAll(/\S+/g)){
    let depth=0,start=0;
    for(let i=0;i<token[0].length;i++){
      if(token[0][i]==='[')depth++;
      else if(token[0][i]===']')depth--;
      else if(token[0][i]===':' && depth===0)start=i+1;
    }
    for(const match of token[0].matchAll(ARBITRARY)){
      if(match.index+match[0].length<=start)continue;
      match.index+=token.index;
      yield {match,variant:token[0].slice(0,start)};
    }
  }
}

export function hasWidthConstraint(classes:string[],variant:string){
  return classes.some(token=>{
    const utility=variant && token.startsWith(variant)?token.slice(variant.length):token;
    return /^!?(?:w-full|max-w-(?!none!?$)(?:\[[^\]]+\]|[\w.-]+))!?$/.test(utility);
  });
}
export const STYLE_COLOR_KEYS = new Set(['color', 'background', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'outlineColor', 'fill', 'stroke', 'boxShadow', 'textDecorationColor', 'caretColor']);
export const STYLE_SIZE_KEYS = /^(padding|margin|gap|rowGap|columnGap|fontSize|borderRadius|letterSpacing)/;
const STYLE_PREFIX: Array<[RegExp, string]> = [[/^paddingLeft|^paddingInlineStart/, 'pl'], [/^paddingRight|^paddingInlineEnd/, 'pr'], [/^paddingTop/, 'pt'], [/^paddingBottom/, 'pb'], [/^padding/, 'p'],
  [/^marginLeft/, 'ml'], [/^marginRight/, 'mr'], [/^marginTop/, 'mt'], [/^marginBottom/, 'mb'], [/^margin/, 'm'], [/^(gap|rowGap|columnGap)/, 'gap'], [/^fontSize/, 'text'], [/^borderRadius/, 'rounded']];
export const stylePrefix = (key: string) => STYLE_PREFIX.find(([pattern]) => pattern.test(key))?.[1];
export const COLOR_IN_TEXT = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/;

export function toPx(value: number, unit: string): number {
  return unit === 'px' ? value : value * 16;
}

export function trimSnippet(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > 140 ? `${single.slice(0, 137)}...` : single;
}

/** Text worth naming a problem after: at least two characters and some letters or CJK, not "/" or "1". */
export const meaningful = (text: string) => text.length >= 2 && /[\p{L}]/u.test(text);

/** `background-color` → `backgroundColor`. */
export const camelCase = (name: string) => name.trim().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
