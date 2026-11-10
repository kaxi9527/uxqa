import { analyze } from '@projectwallace/css-analyzer';
import { is_declaration, parse, walk } from '@projectwallace/css-parser';
import type { Page } from 'playwright';
import type { CssAnalysis, CssAudit } from './types.js';

export function analyzeCss(css: string, label: string): CssAnalysis {
  if (Buffer.byteLength(css)>2_000_000) throw new Error('CSS stylesheet exceeds the 2 MB analysis limit');
  const metrics = analyze(css);
  const spacing = new Set<string>();
  walk(parse(css),(node) => {
    if (is_declaration(node) && /^(margin|padding)(-|$)|^(gap|row-gap|column-gap)$/.test(node.property) && node.value) spacing.add(node.value.text);
  });
  return {label,metrics,summary:{
    bytes:metrics.stylesheet.size,selectors:metrics.selectors.total,declarations:metrics.declarations.total,
    uniqueColors:metrics.values.colors.totalUnique,uniqueFontFamilies:metrics.values.fontFamilies.totalUnique,
    uniqueFontSizes:metrics.values.fontSizes.totalUnique,uniqueBorderRadii:metrics.values.borderRadiuses.totalUnique,
    definedTokens:metrics.properties.custom.defined.length,usedTokens:metrics.properties.custom.used.length,
    unknownTokens:metrics.properties.custom.unknown,unusedTokens:metrics.properties.custom.unused,
    tokenDefinitionRatio:metrics.properties.custom.ratio,complexity:metrics.stylesheet.complexity,
    spacingValues:[...spacing].sort(),
  }};
}

export async function analyzePageCss(page: Page): Promise<CssAudit> {
  const styles = await page.evaluate(() => {
    const sheets = [...document.styleSheets,...document.adoptedStyleSheets];
    const css:string[]=[];
    const gaps:string[]=[];
    const visited = new Set<CSSStyleSheet>();
    let characters=0;
    function visit(sheet: CSSStyleSheet): void {
      if (visited.has(sheet)) return;
      visited.add(sheet);
      const label = sheet.href ? new URL(sheet.href).origin+new URL(sheet.href).pathname:'inline stylesheet';
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSImportRule && rule.styleSheet) { visit(rule.styleSheet); continue; }
          if (characters+rule.cssText.length>2_000_000) { gaps.push('CSS collection reached the 2 MB limit'); return; }
          css.push(rule.cssText); characters+=rule.cssText.length;
        }
      } catch { gaps.push(`Stylesheet inaccessible through CSSOM: ${label}`); }
    }
    for (const sheet of sheets.slice(0,100)) visit(sheet);
    if (sheets.length>100) gaps.push('More than 100 stylesheets; collection limited');
    if (document.querySelector('[style]')) gaps.push('Inline style attributes are outside stylesheet metrics; see computed DOM samples');
    return {css:css.join('\n'),gaps};
  });
  try {
    return {status:styles.gaps.length ? 'partial':'complete',gaps:styles.gaps,
      analyses:styles.css ? [analyzeCss(styles.css,'browser stylesheets')]:[]};
  } catch (error) {
    return {status:'partial',analyses:[],gaps:[...styles.gaps,error instanceof Error ? error.message:String(error)]};
  }
}
