import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATUS_LABELS, summarizeRun, VERDICT_LABELS, screenshotNotice, type ScreenshotPolicy } from './report.js';
import type { CheckResult, RunResult } from './types.js';

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function checkRow(check: CheckResult): string {
  const evidence = check.evidence?.length ? check.evidence.map((entry) => `\`${entry.split('/').pop()}\``).join(', ') : '';
  return `| ${cell(check.requirement ?? '')} | ${check.dimension} | ${cell(check.flow ? `${check.check}: ${check.flow}` : check.check)} | \`${cell(check.route)}\` | ${cell(check.viewport)} | **${STATUS_LABELS[check.status]}** | ${cell(check.detail)} | ${evidence} |`;
}

export async function writeReports(result: RunResult, outDir: string, screenshotRetention:ScreenshotPolicy='managed-48h'): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outDir, { recursive: true });
  const summary = summarizeRun(result);
  const jsonPath = join(outDir, 'report.json');
  const markdownPath = join(outDir, 'report.md');
  const checks = result.checks ?? [];
  const automated = checks.filter((check) => check.route !== '(all)');
  const gaps = checks.filter((check) => check.route === '(all)');
  const requirements = [...new Set(checks.flatMap((check) => check.requirement ? [check.requirement] : []))];
  const evidence = result.evidence;
  const git = evidence?.product.git;
  const header = '| 需求 | 维度 | 检查 | 路由 | 视口 | 结果 | 说明 | 证据 |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
  const lines = [
    `# QA Master report: ${result.configName}`,
    '',
    `Status: **${summary.status.toUpperCase()}**`,
    `阻断级发现 / Blocking findings: ${summary.blocking}`,
    `Informational findings: ${summary.informational}`,
    '',
    `结论（Q-03）：**${VERDICT_LABELS[summary.verdict]}** — ${Object.entries(summary.checks).map(([status, count]) => `${STATUS_LABELS[status as keyof typeof STATUS_LABELS]} ${count}`).join(' · ')}`,
    '',
    '阻断级发现统计问题的严重度；检查受阻表示缺少运行条件。页面结果综合该路由和视口的全部检查。 / Finding severity and blocked checks are counted separately. Page results aggregate scoped checks.',
    '',
    '## 检查范围 / Coverage',
    ...(result.coverage ? [
      '', '浏览器实测 · 未扫描源码目录 / Browser run · no source directories scanned',
      ...result.coverage.pages.map(p => '- ' + cell(p.route) + ' · ' + p.viewport + ' · ' + STATUS_LABELS[p.status]),
      '', '跳过或未完成的检查 / Skipped or incomplete checks',
      ...result.coverage.skippedChecks.map(c => '- ' + c.check + ' · ' + cell(c.route) + ' · ' + c.viewport + ' · ' + STATUS_LABELS[c.status] + ' · ' + cell(c.detail)),
      ...(result.coverage.skippedChecks.length ? [] : ['无 / None']),
    ] : ['历史运行未记录覆盖清单 / Coverage was not recorded for this run']),
    '', '## 证据元数据',
    '',
    ...(evidence ? [
      `- 时间：${result.startedAt} → ${result.endedAt}`,
      `- 被测地址：${evidence.baseUrl}${evidence.environment ? `（环境：${evidence.environment}）` : '（环境未标注）'}`,
      `- 测试数据性质：${evidence.dataNature}`,
      `- 代码修订：${git?.revision ? `${evidence.product.root} ${git.branch ?? 'detached'}@${git.revision}${git.dirty ? `，未提交改动 ${git.changedFiles} 个` : '，工作区干净'}` : git?.error ?? '未记录（配置 evidence.productRoot）'}`,
      ...(git?.dirty && git.changed?.length ? [`- 未提交文件（前 ${git.changed.length} 个）：${git.changed.map((entry) => `\`${entry.trim()}\``).join(', ')}`] : []),
      `- 工具：uxqa ${evidence.uxqaVersion} · ${evidence.browser ?? 'browser unavailable'} · ${evidence.headless ? 'headless' : 'headed'} · node ${evidence.node} · ${evidence.platform}`,
    ] : ['- 无']),
    '',
    ...(requirements.length ? [
      '## 需求追踪',
      '',
      ...requirements.map((requirement) => {
        const related = checks.filter((check) => check.requirement === requirement);
        const counts = related.reduce<Record<string, number>>((all, check) => ({ ...all, [STATUS_LABELS[check.status]]: (all[STATUS_LABELS[check.status]] ?? 0) + 1 }), {});
        return `- ${requirement}: ${Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(' · ')}`;
      }),
      '',
    ] : []),
    '## 检查结果',
    '',
    ...(automated.length ? [header, ...automated.map(checkRow)] : ['无自动检查结果。']),
    '',
    '## 未覆盖 / 未验证',
    '',
    ...(gaps.length ? [header, ...gaps.map(checkRow)] : ['无。']),
    '',
    '## Findings',
    '',
    ...(result.findings.length === 0
      ? ['No findings.']
      : result.findings.map((finding) => {
          const evidenceList = finding.evidence?.length ? ` Evidence: ${finding.evidence.join(', ')}` : '';
          const step = finding.step ? ` Step: ${finding.step}.` : '';
          const requirement = finding.requirement ? ` ${finding.requirement}.` : '';
          return `- [${finding.severity}] **${finding.kind}** ${finding.message}.${requirement}${step} Route: \`${finding.route}\`, viewport: \`${finding.viewport}\`.${evidenceList}`;
        })),
    '',
    '## Artifacts',
    '',
    screenshotNotice(screenshotRetention),
    '',
    ...(result.artifacts.length === 0 ? ['No artifacts.'] : result.artifacts.map((artifact) => `- ${artifact}`)),
  ];
  await writeFile(jsonPath, JSON.stringify({ ...result, screenshotRetention, summary }, null, 2),{mode:0o600});
  await writeFile(markdownPath, `${lines.join('\n')}\n`,{mode:0o600});
  return { jsonPath, markdownPath };
}
