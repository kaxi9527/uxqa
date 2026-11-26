import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FigmaReport } from './types.js';

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const md = (s: string) => s.replace(/\\/g, '\\\\').replace(/[|\r\n]/g, ' ').replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;').replace(/([\[\]`])/g, '\\$1');
export function renderFigmaReport(r: FigmaReport): { markdown: string; html: string } {
  const issues = r.checks.filter(c => c.status !== 'pass' && c.status !== 'excluded');
  const url = (id: string) => `https://www.figma.com/design/${encodeURIComponent(r.source.fileKey)}?node-id=${encodeURIComponent(id)}`;
  const summary = figmaSummary(r)+'\n'+Object.entries(r.summary).map(([status,count])=>status+' '+count).join(' · ');
  const markdown = `# QA Master Figma · ${md(r.source.pageName)}\n\n${summary}\n\n采集窗口：${r.source.capturedAt} — ${r.source.captureEnd}\n\n主题：${r.coverage.themes.map(md).join(', ')}\n\n缺失组件：${r.coverage.missingIds.map(md).join(', ') || '无'}\n\n## 问题与未验证项\n\n| 状态 | 规则 | 组件 / 节点 | 主题 | 观察 |\n| --- | --- | --- | --- | --- |\n` + issues.map(c => `| ${c.status} | ${c.rule} | [${md(c.component)} · ${md(c.nodeId)}](${url(c.nodeId)}) | ${md(c.theme || '—')} | ${md(c.message)}${c.observed !== undefined ? ` (${c.observed} / ${c.threshold})` : ''} |`).join('\n') + '\n\n## 覆盖限制\n\n' + r.limitations.map(x => '- ' + x).join('\n') + '\n';
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>QA Master Figma</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#202020;background:#f6f6f6;margin:28px}table{border-collapse:collapse;width:100%;background:white}td,th{padding:10px;text-align:left;border:1px solid #ccc;vertical-align:top}a{color:#164e87}code{overflow-wrap:anywhere}.fail{background:#fee}.review{background:#fff5da}h1{font-size:24px}</style><h1>QA Master Figma · ${escapeHtml(r.source.pageName)}</h1><p>${escapeHtml(summary)}</p><p>采集窗口：${escapeHtml(r.source.capturedAt)} — ${escapeHtml(r.source.captureEnd)}</p><p>缺失组件：${escapeHtml(r.coverage.missingIds.join(', ') || '无')}</p><table><thead><tr><th>状态 / 规则</th><th>组件 / 节点</th><th>主题</th><th>观察</th></tr></thead><tbody>` + issues.map(c => `<tr class="${c.status}"><td>${escapeHtml(c.status)}<br>${escapeHtml(c.rule)}</td><td><a href="${url(c.nodeId)}">${escapeHtml(c.component)}</a><br><code>${escapeHtml(c.nodeId)}</code></td><td>${escapeHtml(c.theme || '—')}</td><td>${escapeHtml(c.message)}${c.observed !== undefined ? ` (${c.observed} / ${c.threshold})` : ''}</td></tr>`).join('') + '</tbody></table><h2>覆盖限制</h2><ul>' + r.limitations.map(x => `<li>${escapeHtml(x)}</li>`).join('') + '</ul></html>';
  const candidateMarkdown = '\n## 通用化与合并候选（待业务语义复核）\n\n' + r.mergeCandidates.map(g => '- ' + g.names.map((name, i) => `[${md(name)}](${url(g.sets[i])})`).join(' / ') + '：' + g.reason).join('\n') + '\n\n## 组件集清单\n\n| 组件集 | 变体数 | 字体 | 依赖组件 |\n| --- | --- | --- | --- |\n' + r.catalog.map(c => `| [${md(c.name)}](${url(c.id)}) | ${c.variants} | ${md(c.fonts.join(', '))} | ${md(c.dependencies.join(', '))} |`).join('\n') + '\n';
  const candidateHtml = '<h2>通用化与合并候选（待业务语义复核）</h2><p>只有结构证据，尚无自动合并结论；新增身份必须另有时间基线。</p><ul>' + r.mergeCandidates.map(g => '<li>' + g.names.map((name, i) => `<a href="${url(g.sets[i])}">${escapeHtml(name)}</a>`).join(' / ') + '：' + escapeHtml(g.reason) + '</li>').join('') + '</ul><details><summary>组件集清单（' + r.catalog.length + '）</summary><table><tr><th>组件集</th><th>变体数</th><th>字体</th><th>依赖</th></tr>' + r.catalog.map(c => `<tr><td><a href="${url(c.id)}">${escapeHtml(c.name)}</a></td><td>${c.variants}</td><td>${escapeHtml(c.fonts.join(', '))}</td><td>${escapeHtml(c.dependencies.join(', '))}</td></tr>`).join('') + '</table></details><h2>设计规则问题与未验证项</h2>';
  const gaps = [...new Set(r.checks.filter(c => c.status === 'excluded' || c.status === 'not-verified').map(c => c.rule + ' · ' + c.message))];
  const scope = ['设计稿采集 · 未扫描源码目录 / Design capture · no source directories scanned',
    '清单来源 / Index evidence · '+(r.coverage.inventoryEvidence??'unknown'),
    (r.source.fileKeyObserved?'文件键已由连接核对 / File key observed':'文件键来自采集配置 / File key from capture configuration'),
    '索引 SHA-256 · '+(r.source.inputHashes['index.json']??'—'),
    ...(r.mergeCandidates.length?[]:[r.status==='partial'?'当前采集内无骨架候选；剩余组件未参与比较。 / No candidates in this partial capture.':'完整采集内无跨组件集的相同骨架候选。 / No shared skeleton candidates in this capture.']),
    '排除或未验证的规则 / Excluded or unverified rules', ...(gaps.length ? gaps : ['无 / None'])];
  return { markdown: markdown.replace('## 问题与未验证项', () => '## 检查范围 / Coverage\n\n'+scope.map(line=>'- '+md(line)).join('\n')+'\n\n'+candidateMarkdown+'\n## 问题与未验证项'),
    html: html.replace('<table><thead>', () => '<h2>检查范围 / Coverage</h2><ul>'+scope.map(line=>'<li>'+escapeHtml(line)+'</li>').join('')+'</ul>'+candidateHtml+'<table><thead>') };
}
export function figmaSummary(r:FigmaReport):string {
  const c=r.coverage;
  return `${r.status} / ${r.verdict} · 实采 / captured ${c.capturedComponents} · 索引 / indexed ${c.expectedComponents} · 页面主件 / page masters ${c.pageTotal??'unknown'}\n`+
    (r.status==='complete'?'主件清单已对账 / Master inventory reconciled. ':'覆盖不完整或未能对账 / Partial or unverified inventory. ')+
    ({'needs-review':'仍有待复核或缺失证据 / Review or evidence needed.','issues-found':'有规则失败 / Rule failures found.','limited-pass':'仅已执行规则通过 / Executed design rules passed.'}[r.verdict]);
}
export async function writeFigmaReport(r: FigmaReport, out: string): Promise<void> {
  const rendered = renderFigmaReport(r);
  for (const [name, content] of [['figma.json', JSON.stringify(r, null, 2)], ['figma.md', rendered.markdown], ['figma.html', rendered.html]])
    await writeFile(join(out, name), content, { flag: 'wx', mode: 0o600 });
}
