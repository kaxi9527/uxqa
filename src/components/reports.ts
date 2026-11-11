import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentAudit } from './types.js';
import { artifactLink as link, escape } from './html.js';
import { cssDetails, reactDetails, libraryDetails } from './report-sections.js';

export async function writeComponentReports(audit: ComponentAudit, outDir: string): Promise<{jsonPath:string;markdownPath:string;htmlPath:string}> {
  const jsonPath = join(outDir,'components.json');
  const markdownPath = join(outDir,'components.md');
  const htmlPath = join(outDir,'components.html');
  const summary = `${audit.candidates.length} candidates, ${audit.observations.length} observations, ${audit.source?.duplicates.length ?? 0} source clones, ${audit.source?.components.length ?? 0} React components`;
  const markdown = [`# Component audit: ${audit.name}`,'',`Status: ${audit.status}`,summary,'',
    'UXQA 登记的截图保留 48 小时，运行期间或下次启动时清理；报告保留。 / UXQA-registered screenshots are cleaned after 48 hours while UXQA runs or on its next launch; this report remains.','',
    '## Product component library','',`Discovery: ${audit.library?.status ?? 'source not supplied'}`,`Target: ${audit.library?.library?.root ?? 'not bound'}`,
    'Componentization requires library binding, implementation, fresh verification, then spec/catalog sync.','',
    '## Component candidates','',...audit.candidates.flatMap((candidate) => [
      `### ${candidate.name} (${candidate.viewport})`,candidate.reason,
      `Routes: ${candidate.routes.join(', ')}`,`Possible props: ${candidate.suggestedProps.join(', ')}`,
      `Style differences: ${Object.keys(candidate.differences).join(', ') || 'none observed'}`,
      'Human review required.',...candidate.instances.map((entry) => `- ${entry.route} / ${entry.state} / ${entry.selector}; screenshot: ${entry.screenshot ?? 'unavailable'}`),'',
    ]),'## Existing React usage','',...(audit.source?.components.map((entry) => `- ${entry.module} :: ${entry.name}: ${entry.count} usages; props: ${entry.props.join(', ')}`) ?? []),
    '', '## React attribute patterns','',...(audit.source?.components.flatMap((component) => component.propPatterns.map((pattern) => `- ${component.module} :: ${component.name}.${pattern.prop}: supplied ${pattern.supplied}, absent ${pattern.missing}, spread unknown ${pattern.spreadUnknown}, dynamic ${pattern.dynamic}`)) ?? []),
    '', '## Import origins to review','',...(audit.source?.importConflicts.map((conflict) => `- ${conflict.name}: ${conflict.modules.join(', ')}`) ?? []),
    '', '## CSS metrics','',...(audit.css ?? []).flatMap((entry) => entry.audit.analyses.map((analysis) => `- ${entry.route} / ${entry.viewport}: ${JSON.stringify(analysis.summary)}`)),
    ...(audit.source?.css.analyses.map((analysis) => `- Source CSS: ${JSON.stringify(analysis.summary)}`) ?? []),
    '', '## Source duplication','',...(audit.source?.duplicates.map((clone) => `- ${clone.kind}: ${clone.first.file}:${clone.first.line} and ${clone.second.file}:${clone.second.line}, ${clone.lines} lines`) ?? []),
    '', '## Coverage and tools','',...audit.coverage.map((entry) => `- ${entry.route} / ${entry.viewport} / ${entry.state}: ${entry.status}${entry.error ? ` (${entry.error})`:''}`),
    ...audit.tools.map((tool) => `- ${tool.name} ${tool.version}: ${tool.status}${tool.error ? ` (${tool.error})`:''}${tool.artifact ? `; ${tool.artifact}`:''}`),
    '', '## Limits','',...audit.limitations.map((limit) => `- ${limit}`), '',
  ].join('\n');

  const candidates = audit.candidates.map((candidate) => `<article><h2>${escape(candidate.name)} <small>${escape(candidate.viewport)} · ${candidate.occurrences} occurrences</small></h2>
<p>${escape(candidate.reason)} Human review required.</p><p>Possible props: <code>${escape(candidate.suggestedProps.join(', '))}</code></p>
<table><thead><tr><th>Style property</th><th>Observed values</th></tr></thead><tbody>${Object.entries(candidate.differences).map(([property,values]) => `<tr><td>${escape(property)}</td><td>${escape(values.join(' | '))}</td></tr>`).join('')}</tbody></table>
<div class="instances">${candidate.instances.map((entry) => `<figure>${entry.screenshot ? `<a href="${escape(link(entry.screenshot,outDir))}"><img src="${escape(link(entry.screenshot,outDir))}" alt="${escape(candidate.name)} on ${escape(entry.route)}"></a>`:'<p>Screenshot unavailable</p>'}<figcaption><strong>${escape(entry.route)}</strong> · ${escape(entry.state)}<br><code>${escape(entry.selector)}</code></figcaption></figure>`).join('')}</div></article>`).join('');
  const tools = audit.tools.map((tool) => `<tr><td>${escape(tool.name)} ${escape(tool.version)}</td><td>${escape(tool.status)}</td><td>${tool.artifact ? `<a href="${escape(link(tool.artifact,outDir))}">Evidence</a>`:''} ${escape(tool.error ?? '')}</td></tr>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Component audit</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#20242b;background:#fff;margin:0}main{max-width:1200px;margin:auto;padding:24px}h1{font-size:24px}h2{font-size:18px}h1,h2{overflow-wrap:anywhere}small{font-size:13px;font-weight:400;color:#58636b}header{border-bottom:2px solid #16856c;padding-bottom:16px}section{padding:20px 0;border-bottom:1px solid #dde2e5}article{padding:16px 0;border-bottom:1px solid #dde2e5}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #dde2e5;text-align:left;padding:8px;overflow-wrap:anywhere}code{font-size:12px;overflow-wrap:anywhere}a{color:#1269aa}.instances{display:flex;flex-wrap:wrap;gap:16px}figure{margin:12px 0;width:280px;max-width:100%}.instances a{display:flex;align-items:center;justify-content:center;height:180px;border:1px solid #dde2e5;background:#f7f9fa}img{width:auto;height:auto;max-width:100%;max-height:180px;object-fit:contain}figcaption{overflow-wrap:anywhere}p{overflow-wrap:anywhere}.status{font-weight:600;color:${audit.status==='complete' ? '#16856c':'#b35319'}}@media(max-width:600px){main{padding:16px}table{display:block;overflow:auto}figure{width:100%}}</style></head>
<body><main><header><h1>${escape(audit.name)}</h1><p class="status">${escape(audit.status.toUpperCase())}</p><p>${escape(summary)}</p><p>UXQA 登记的截图保留 48 小时，运行期间或下次启动时清理；报告保留。 / UXQA-registered screenshots are cleaned after 48 hours while UXQA runs or on its next launch; this report remains.</p><nav aria-label="Report sections"><a href="#candidates">Components</a> · <a href="#react">React</a> · <a href="#css">CSS</a> · <a href="#coverage">Coverage</a></nav></header>
${libraryDetails(audit)}
<section id="candidates"><h2>Component candidates</h2>${candidates || '<p>No cross-page candidates in observed coverage.</p>'}</section>
<section id="react"><h2>Existing React component usage</h2><table><thead><tr><th>Component / aliases</th><th>Module</th><th>Usages / files</th><th>Props</th><th>Locations</th></tr></thead><tbody>${audit.source?.components.map((entry) => `<tr><td>${escape(entry.name)}<br><small>${escape((entry.aliases ?? []).join(', '))}</small></td><td>${escape(entry.module)}</td><td>${entry.count} / ${entry.fileCount}</td><td>${escape(entry.props.join(', '))}</td><td>${escape(entry.locations.map((location) => `${location.file}:${location.line}`).join(', '))}</td></tr>`).join('') ?? ''}</tbody></table></section>
${reactDetails(audit)}${cssDetails(audit,outDir)}
<section><h2>Source duplication</h2><table><thead><tr><th>Kind</th><th>First location</th><th>Second location</th><th>Lines</th></tr></thead><tbody>${audit.source?.duplicates.map((clone) => `<tr><td>${escape(clone.kind)}</td><td>${escape(`${clone.first.file}:${clone.first.line}`)}</td><td>${escape(`${clone.second.file}:${clone.second.line}`)}</td><td>${clone.lines}</td></tr>`).join('') ?? ''}</tbody></table></section>
<section id="coverage"><h2>Observed coverage</h2><table><thead><tr><th>Route</th><th>Viewport</th><th>State</th><th>Status</th></tr></thead><tbody>${audit.coverage.map((entry) => `<tr><td>${escape(entry.route)}</td><td>${escape(entry.viewport)}</td><td>${escape(entry.state)}</td><td>${escape(entry.status)} ${escape(entry.error ?? '')}</td></tr>`).join('')}</tbody></table></section>
<section><h2>Analysis tools</h2><table><thead><tr><th>Tool</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${tools}</tbody></table></section>
<section><h2>Limits</h2><ul>${audit.limitations.map((limit) => `<li>${escape(limit)}</li>`).join('')}</ul></section></main></body></html>`;
  await writeFile(jsonPath,JSON.stringify(audit,null,2),{mode:0o600});
  await writeFile(markdownPath,markdown,{mode:0o600});
  await writeFile(htmlPath,html,{mode:0o600});
  return {jsonPath,markdownPath,htmlPath};
}
