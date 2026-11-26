import type { CheckResult, CheckStatus, RunResult } from './types.js';

export type ScreenshotPolicy = 'managed-48h'|'user-export';
export function screenshotNotice(policy:ScreenshotPolicy){
  return policy==='user-export'?'自选导出目录，截图由用户保留。 / Screenshots in this export are retained by the user.':'登记的截图保留 48 小时，运行期间或下次启动时清理。 / Registered screenshots expire after 48 hours while QA Master runs or on its next launch.';
}

export type Verdict = 'pass' | 'pass-with-gaps' | 'blocked' | 'fail';

export function summarizePages(checks:CheckResult[]){
  const pages=new Map<string,Pick<CheckResult,'route'|'viewport'|'status'>>();
  const rank={'not-applicable':0,pass:1,'not-verified':2,blocked:3,fail:4};
  for(const {route,viewport,status} of checks){
    if(route==='(all)')continue;
    const key=JSON.stringify([route,viewport]);
    const previous=pages.get(key);
    if(!previous || rank[status]>rank[previous.status])pages.set(key,{route,viewport,status});
  }
  return [...pages.values()];
}

export interface RunSummary {
  status: 'passed' | 'failed';
  blocking: number;
  informational: number;
  /** Q-03 view: worst automated outcome, with unverified coverage kept visible. */
  verdict: Verdict;
  checks: Record<CheckStatus, number>;
}

export const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: '通过',
  fail: '失败',
  blocked: '检查受阻',
  'not-verified': '未验证',
  'not-applicable': '不适用',
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  pass: '通过',
  'pass-with-gaps': '自动检查范围内通过，存在未验证项',
  blocked: '阻塞',
  fail: '失败',
};

export function summarizeRun(result: RunResult): RunSummary {
  const blocking = result.findings.filter((finding) => finding.severity === 'blocking').length;
  const informational = result.findings.length - blocking;
  const checks: Record<CheckStatus, number> = { pass: 0, fail: 0, blocked: 0, 'not-verified': 0, 'not-applicable': 0 };
  for (const check of result.checks ?? []) checks[check.status]++;
  const verdict: Verdict = checks.fail || (blocking && !checks.blocked) ? 'fail' : checks.blocked ? 'blocked' : checks['not-verified'] ? 'pass-with-gaps' : 'pass';
  return { status: blocking > 0 ? 'failed' : 'passed', blocking, informational, verdict, checks };
}
