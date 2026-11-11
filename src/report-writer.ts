import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATUS_LABELS, summarizeRun, VERDICT_LABELS } from './report.js';
import type { CheckResult, RunResult } from './types.js';

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function checkRow(check: CheckResult): string {
  const evidence = check.evidence?.length ? check.evidence.map((entry) => `\`${entry.split('/').pop()}\``).join(', ') : '';
  return `| ${cell(check.requirement ?? '')} | ${check.dimension} | ${cell(check.flow ? `${check.check}: ${check.flow}` : check.check)} | \`${cell(check.route)}\` | ${cell(check.viewport)} | **${STATUS_LABELS[check.status]}** | ${cell(check.detail)} | ${evidence} |`;
}

export async function writeReports(result: RunResult, outDir: string): Promise<{ jsonPath: string; markdownPath: string }> {
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
    `# UXQA report: ${result.configName}`,
    '',
    `Status: **${summary.status.toUpperCase()}**`,
    `Blocking findings: ${summary.blocking}`,
    `Informational findings: ${summary.informational}`,
    '',
    `结论（Q-03）：**${VERDICT_LABELS[summary.verdict]}** — ${Object.entries(summary.checks).map(([status, count]) => `${STATUS_LABELS[status as keyof typeof STATUS_LABELS]} ${count}`).join(' · ')}`,
    '',
    '完成声明只覆盖下表“通过”的自动检查；“未验证”和“阻塞”项不能视为通过。',
    '',
    '## 证据元数据',
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
    'UXQA 登记的截图保留 48 小时，运行期间或下次启动时清理；报告保留。 / UXQA-registered screenshots are cleaned after 48 hours while UXQA runs or on its next launch; this report remains.',
    '',
    ...(result.artifacts.length === 0 ? ['No artifacts.'] : result.artifacts.map((artifact) => `- ${artifact}`)),
  ];
  await writeFile(jsonPath, JSON.stringify({ ...result, summary }, null, 2),{mode:0o600});
  await writeFile(markdownPath, `${lines.join('\n')}\n`,{mode:0o600});
  return { jsonPath, markdownPath };
}
