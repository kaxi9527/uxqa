import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/check/run.js';
import { GUIDES, screenshotGuidance } from '../src/guidance/catalog.js';
import { issueGuidance } from '../src/guidance/issues.js';
import { recheckComparison } from '../src/ui/issue-workflow.js';
import { startConsole, type ConsoleServer } from '../src/ui/server.js';
import { addProject, getRound, saveRound, type Round } from '../src/ui/store.js';

let home: string;
let server: ConsoleServer;
let projectId: string;
let round: Round;
const token = 'guidance-workflow-local-test';
const priorHome = process.env.UXQA_HOME;
const priorToken = process.env.UXQA_UI_TOKEN;

async function call(path: string, body?: unknown, authenticated = true) {
  const response = await fetch(`http://127.0.0.1:${server.port}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(authenticated ? { 'x-uxqa-token': token } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'uxqa-guidance-test-'));
  process.env.UXQA_HOME = home;
  process.env.UXQA_UI_TOKEN = token;
  const root = resolve('examples/check-fixture');
  projectId = (await addProject(root)).id;
  round = await saveRound(projectId, await runCheck({ source: root }));
  server = await startConsole({ port: 0 });
});

afterAll(async () => {
  await server?.close();
  if (priorHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = priorHome;
  if (priorToken === undefined) delete process.env.UXQA_UI_TOKEN; else process.env.UXQA_UI_TOKEN = priorToken;
  await rm(home, { recursive: true, force: true });
});

describe('native quality knowledge', () => {
  it('feeds classification and screenshot diagnosis with actionable native procedures', () => {
    expect(GUIDES).toHaveLength(27);
    expect(new Set(GUIDES.map((guide) => guide.domain))).toEqual(new Set(['ui', 'ux', 'experience']));
    expect(GUIDES.every((guide) => guide.checks.length && guide.fix && guide.verify)).toBe(true);
    expect(screenshotGuidance().join('\n')).toContain('视觉层级');
    expect(screenshotGuidance().join('\n')).not.toMatch(/Impeccable|Kowalski|Pro Max|dangerously-skip|bypassPermissions/);
  });
  it('serves native procedures for workflows and removes the standalone reference browser', async () => {
    expect((await call('/quality', undefined, false)).status).toBe(401);
    const result = await call('/quality');
    expect(result.status).toBe(200);
    expect(result.data.procedures).toHaveLength(27);
    expect(result.data.procedures[0]).not.toHaveProperty('sources');
    expect((await call('/guidance')).status).toBe(404);
  });
});

describe('issue handling and honest rechecks', () => {
  it('classifies legacy issues without changing their evidence or severity', () => {
    const original = round.result.violations[0];
    const before = JSON.stringify(original);
    expect(issueGuidance({ ...original, rule: 'color/raw' }).domain).toBe('ui');
    expect(issueGuidance({ ...original, rule: 'a11y/label' }).domain).toBe('ux');
    expect(issueGuidance({ ...original, rule: 'motion/duration' }).domain).toBe('experience');
    expect(issueGuidance({ ...original, domain: 'experience' }).domain).toBe('experience');
    expect(JSON.stringify(original)).toBe(before);
  });

  it('persists handling state, category overrides and evidence without rewriting stored rounds', async () => {
    const prefix = `/projects/${projectId}`;
    const original = JSON.stringify(await getRound(projectId, round.id));
    const fingerprint = round.result.violations[0].fingerprint;
    const input = { roundId: round.id, fingerprint, state: 'accepted', domain: 'experience', note: '已核对产品规则，保留该偏差。' };
    expect((await call(`${prefix}/issue-workflow`, { ...input, note: '' })).status).toBe(400);
    expect((await call(`${prefix}/issue-workflow`, { ...input, state: 'auto-passed' })).status).toBe(400);
    expect((await call(`${prefix}/issue-workflow`, { ...input, fingerprint: 'missing' })).status).toBe(404);
    expect((await call(`${prefix}/issue-workflow`, input)).status).toBe(200);
    expect((await call(`${prefix}/issue-workflow`)).data.workflow.dispositions[fingerprint]).toMatchObject({ state: input.state, domain: input.domain, note: input.note, roundId: input.roundId });
    const presented = (await call(`${prefix}/rounds/${round.id}`)).data.round.result.violations.find((issue: { fingerprint: string }) => issue.fingerprint === fingerprint);
    expect(presented.quality.domain).toBe('experience');
    expect(JSON.stringify(await getRound(projectId, round.id))).toBe(original);
  });

  it('keeps manual observations project-local and separate from automatic results', async () => {
    const prefix = `/projects/${projectId}`;
    expect((await call(`${prefix}/observations`, { name: '卡顿' })).status).toBe(400);
    const input = { name: '快速切换时卡顿', domain: 'experience', location: '/settings · 桌面', detail: '连续切换三个标签，第二次仍显示旧内容，重现 3 次。' };
    const result = await call(`${prefix}/observations`, input);
    expect(result.status).toBe(200);
    const issue = result.data.workflow.observations[0];
    expect(issue).toMatchObject({ origin: 'manual', domain: 'experience', level: 'reference' });
    const presented = (await call(`${prefix}/rounds/${round.id}`)).data.round.result.violations;
    expect(presented.some((item: { fingerprint: string }) => item.fingerprint === issue.fingerprint)).toBe(true);
    expect((await getRound(projectId, round.id))?.result.violations.some((item) => item.fingerprint === issue.fingerprint)).toBe(false);
    expect((await call(`${prefix}/issue-workflow`, { roundId: round.id, fingerprint: issue.fingerprint, state: 'confirmed', note: '' })).status).toBe(400);
    expect((await call(`${prefix}/issue-workflow`, { roundId: round.id, fingerprint: issue.fingerprint, state: 'confirmed', note: '按原步骤重现，修复后连续切换十次，未发生旧内容闪回。' })).status).toBe(200);
  });

  it('distinguishes present, excluded and unobserved issues and preserves incomplete coverage', () => {
    const issues = round.result.violations.filter((issue) => issue.status === 'new');
    expect(issues.length).toBeGreaterThan(2);
    const current = { ...round, id: 'next', partial: '页面未能加载', result: { ...round.result, violations: [issues[0], { ...issues[1], status: 'baseline' as const }] } };
    const comparison = recheckComparison(round, current);
    expect(comparison.items.map((item) => item.status)).toContain('present');
    expect(comparison.items.map((item) => item.status)).toContain('excluded');
    expect(comparison.items.map((item) => item.status)).toContain('not-observed');
    expect(comparison.items.find((item) => item.status === 'not-observed')?.explanation).toContain('覆盖不完整');
    expect(recheckComparison(undefined, current).items).toEqual([]);
  });
});
