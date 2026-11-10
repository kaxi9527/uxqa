import { artifactLink, escape } from './html.js';
import type { ComponentAudit, CssAudit } from './types.js';

export function libraryDetails(audit: ComponentAudit): string {
  const library=audit.library;
  if (!library) return '<section><h2>Product component library</h2><p>Source was not supplied; library discovery is required before componentization.</p></section>';
  return `<section><h2>Product component library</h2><p>Product: ${escape(library.productId)} · Library: ${escape(library.status)}</p>
${library.library ? `<p>${escape(library.library.root)} · ${library.library.entries.length} registered components</p><p>Native catalog: ${escape(library.library.catalog)}</p>`:'<p>Componentization is blocked until a unique existing library is identified.</p>'}
<p>Order: discover and bind library, implement component, verify current source and browser flows, sync specification and native catalog with readback.</p>
<ul>${library.issues.map((issue)=>`<li>${escape(issue)}</li>`).join('')}</ul></section>`;
}

export function reactDetails(audit: ComponentAudit): string {
  const source = audit.source;
  if (!source) return '';
  const summary = source.reuse;
  const adoption = summary ? `<p>${summary.sharedComponents} of ${summary.componentCount} observed components appear in multiple files; ${summary.instances} JSX usages.</p>`:'';
  const props = source.components.flatMap((component) => (component.propPatterns ?? []).map((pattern) => `<tr><td>${escape(component.module)} :: ${escape(component.name)}</td><td>${escape(pattern.prop)}</td><td>${pattern.supplied}</td><td>${pattern.missing}</td><td>${pattern.spreadUnknown}</td><td>${pattern.dynamic}</td><td>${escape(pattern.values.map((value) => `${value.kind}: ${JSON.stringify(value.value)} (${value.count})`).join('; '))}</td></tr>`)).join('');
  const conflicts = (source.importConflicts ?? []).map((conflict) => `<tr><td>${escape(conflict.name)}</td><td>${escape(conflict.modules.join(', '))}</td><td>${escape(conflict.locations.map((location) => `${location.file}:${location.line}`).join(', '))}</td></tr>`).join('');
  return `<section><h2>React reuse and attribute patterns</h2>${adoption}<p>Counts describe supplied JSX attributes. Expressions, spreads, runtime defaults and child nodes are not resolved into runtime prop values.</p><table><thead><tr><th>Component</th><th>Prop</th><th>Supplied</th><th>Absent</th><th>Spread unknown</th><th>Dynamic</th><th>Static source values</th></tr></thead><tbody>${props}</tbody></table></section>
<section><h2>Import origins to review</h2><p>Same names from different modules are review candidates; aliases can refer to the same implementation.</p><table><thead><tr><th>Name</th><th>Modules</th><th>Locations</th></tr></thead><tbody>${conflicts || '<tr><td colspan="3">No conflicting import origins observed.</td></tr>'}</tbody></table></section>`;
}

export function cssDetails(audit: ComponentAudit, outDir: string): string {
  const scopes: Array<{label:string;css:CssAudit}> = (audit.css ?? []).map((entry) => ({label:`${entry.route} / ${entry.viewport} / initial`,css:entry.audit}));
  if (audit.source?.css) scopes.push({label:'Source CSS files',css:audit.source.css});
  const rows = scopes.flatMap(({label,css}) => css.analyses.map(({summary}) => `<tr><td>${escape(label)}</td><td>${summary.selectors}</td><td>${summary.declarations}</td><td>${summary.uniqueColors}</td><td>${summary.uniqueFontFamilies} / ${summary.uniqueFontSizes}</td><td>${escape(summary.spacingValues.join(', '))}</td><td>${summary.definedTokens} / ${summary.usedTokens}</td><td>${escape(summary.unknownTokens.join(', ')) || 'none'}</td><td>${summary.complexity}</td></tr>`)).join('');
  const evidence = scopes.map(({label,css}) => `<li>${escape(label)}: ${escape(css.status)}${css.artifact ? ` · <a href="${escape(artifactLink(css.artifact,outDir))}">Full Wallace metrics</a>`:''}${css.gaps.length ? ` · ${escape(css.gaps.join('; '))}`:''}</li>`).join('');
  return `<section id="css"><h2>CSS consistency and token observations</h2><p>Authored CSS value counts are observations, not automatic design failures. Equivalent color notation can count separately. Undefined references are unresolved within collected CSS, not necessarily runtime errors.</p><table><thead><tr><th>Scope</th><th>Selectors</th><th>Declarations</th><th>Color values</th><th>Font families / sizes</th><th>Spacing values</th><th>Defined / referenced tokens</th><th>Unresolved token names</th><th>Complexity</th></tr></thead><tbody>${rows}</tbody></table><ul>${evidence}</ul></section>`;
}
