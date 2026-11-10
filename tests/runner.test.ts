import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { runAudit } from '../src/runner.js';

describe('runAudit', () => {
  it('keeps route, viewport, and step context when a flow fails', async () => {
    const output = await mkdtemp(join(tmpdir(), 'uxqa-runner-'));
    const result = await runAudit(
      loadConfig({
        name: 'runner-test',
        baseUrl: 'http://127.0.0.1:1',
        routes: ['/settings'],
        viewports: [{ name: 'mobile', width: 390, height: 844 }],
        flows: [
          {
            name: 'save profile',
            route: '/settings',
            steps: [{ action: 'click', target: { role: 'button', name: 'Save' } }],
          },
        ],
        options: { axe: false, screenshots: false, trace: 'off', keyboard: false, reflow: false, reducedMotion: false },
      }),
      { outDir: output },
    ).finally(() => rm(output, { recursive: true, force: true }));

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'page',
          route: '/settings',
          viewport: 'mobile',
        }),
      ]),
    );
    // An unreachable server is an environment blocker, and dependent checks are blocked rather than passed.
    expect(result.checks.filter((check) => check.route === '/settings').map((check) => [check.check, check.status])).toEqual(
      expect.arrayContaining([['page-load', 'blocked'], ['flow', 'blocked'], ['console', 'blocked']]),
    );
    expect(result.checks.find((check) => check.check === 'code-revision')?.status).toBe('not-verified');
  });
});
