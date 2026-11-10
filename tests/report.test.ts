import { describe, expect, it } from 'vitest';
import { summarizeRun } from '../src/report.js';
import type { CheckResult, RunResult } from '../src/types.js';

const baseResult: RunResult = {
  configName: 'demo',
  startedAt: '2026-10-09T00:00:00.000Z',
  endedAt: '2026-10-09T00:01:00.000Z',
  artifacts: [],
  findings: [],
  checks: [],
};
const noChecks = { pass: 0, fail: 0, blocked: 0, 'not-verified': 0, 'not-applicable': 0 };

describe('summarizeRun', () => {
  it('blocks the run only for blocking findings', () => {
    expect(summarizeRun(baseResult)).toEqual({ status: 'passed', blocking: 0, informational: 0, verdict: 'pass', checks: noChecks });
    expect(
      summarizeRun({
        ...baseResult,
        findings: [
          {
            id: 'a11y-1',
            severity: 'info',
            kind: 'accessibility',
            message: 'Manual review needed',
            route: '/',
            viewport: 'desktop',
          },
        ],
      }),
    ).toEqual({ status: 'passed', blocking: 0, informational: 1, verdict: 'pass', checks: noChecks });
    expect(
      summarizeRun({
        ...baseResult,
        findings: [
          {
            id: 'flow-1',
            severity: 'blocking',
            kind: 'flow',
            message: 'Save failed',
            route: '/',
            viewport: 'desktop',
          },
        ],
      }),
    ).toEqual({ status: 'failed', blocking: 1, informational: 0, verdict: 'fail', checks: noChecks });
  });

  it('reports the Q-03 verdict with unverified coverage kept visible', () => {
    const check = (status: CheckResult['status']): CheckResult => ({ id: status, check: 'flow', dimension: 'behavior', status, route: '/', viewport: 'desktop', detail: '' });
    expect(summarizeRun({ ...baseResult, checks: [check('pass'), check('not-applicable')] }).verdict).toBe('pass');
    expect(summarizeRun({ ...baseResult, checks: [check('pass'), check('not-verified')] }).verdict).toBe('pass-with-gaps');
    expect(summarizeRun({ ...baseResult, checks: [check('pass'), check('blocked'), check('not-verified')] }).verdict).toBe('blocked');
    const mixed = summarizeRun({ ...baseResult, checks: [check('blocked'), check('fail')] });
    expect(mixed.verdict).toBe('fail');
    expect(mixed.checks).toEqual({ ...noChecks, blocked: 1, fail: 1 });
  });
});
