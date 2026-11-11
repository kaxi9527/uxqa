import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GUIDES } from '../src/guidance/guides.js';
import { DIAGNOSTIC_CASES, DIAGNOSIS_FOCUSES } from '../src/guidance/diagnostics.js';
import { diagnosisContext, STACK_KNOWLEDGE } from '../src/guidance/context.js';
import { runCheck } from '../src/check/run.js';
import { startConsole, type ConsoleServer } from '../src/ui/server.js';
import { addProject, getRound, saveRound, type Round } from '../src/ui/store.js';

let home: string, product: string, id: string, round: Round, server: ConsoleServer;
const previousHome = process.env.UXQA_HOME, previousToken = process.env.UXQA_UI_TOKEN;
const token = 'native-diagnosis-fixture-only';
const hashes = async () => {
  const names = (await readdir(product, { recursive: true })).filter((name) => /\.(json|tsx|ts|css|md)$/.test(name));
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, createHash('sha256').update(await readFile(join(product, name))).digest('hex')])));
};
async function call(path: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${server.port}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'x-uxqa-token': token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
async function mcp(messages: unknown[]) {
  const stdout = await new Promise<string>((done, fail) => {
    const child = execFile(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), 'mcp', '--source', product], { env: { ...process.env, UXQA_HOME: home }, maxBuffer: 4 * 1024 * 1024 }, (error, out) => error ? fail(error) : done(out));
    child.stdin?.end(messages.map((message) => JSON.stringify(message)).join('\n') + '\n');
  });
  return stdout.trim().split('\n').map((line) => JSON.parse(line));
}
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'uxqa-diagnosis-home-'));
  product = await mkdtemp(join(tmpdir(), 'uxqa-diagnosis-product-'));
  await cp(resolve('examples/check-fixture'), product, { recursive: true });
  await writeFile(join(product, 'package.json'), JSON.stringify({ name: 'diagnosis-fixture', dependencies: { react: '19', next: '16' }, scripts: { typecheck: 'DO_NOT_EXECUTE_THIS', private: 'DO_NOT_EXPOSE_THIS' } }));
  process.env.UXQA_HOME = home; process.env.UXQA_UI_TOKEN = token;
  id = (await addProject(product, '诊断验证项目')).id;
  round = await saveRound(id, await runCheck({ source: product }));
  server = await startConsole({ port: 0 });
});
afterAll(async () => {
  await server?.close();
  if (previousHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previousHome;
  if (previousToken === undefined) delete process.env.UXQA_UI_TOKEN; else process.env.UXQA_UI_TOKEN = previousToken;
  await rm(home, { recursive: true, force: true }); await rm(product, { recursive: true, force: true });
});

it('routes every native procedure into diagnosis scenarios and actionable verification cases', () => {
  expect(Object.keys(DIAGNOSTIC_CASES).sort()).toEqual(GUIDES.map((guide) => guide.id).sort());
  expect(new Set(DIAGNOSIS_FOCUSES.flatMap((focus) => focus.topics))).toEqual(new Set(GUIDES.map((guide) => guide.id)));
  expect(Object.values(DIAGNOSTIC_CASES).every((cases) => cases.length >= 3 && new Set(cases).size === cases.length)).toBe(true);
  expect(STACK_KNOWLEDGE).toHaveLength(22);
});

it('detects actual project dependencies and reveals script names, never executes or copies command bodies', async () => {
  const context = await diagnosisContext(product);
  expect(context.stacks).toEqual(expect.arrayContaining(['React', 'Next.js']));
  expect(context.scripts).toEqual(['typecheck']);
  expect(JSON.stringify(context)).not.toMatch(/DO_NOT_EXECUTE|DO_NOT_EXPOSE/);
  expect(context.checks.length).toBeGreaterThanOrEqual(4);
});

it('generates and persists a project-specific plan without writing project files or old rounds', async () => {
  const before = await hashes(), original = JSON.stringify(await getRound(id, round.id));
  const response = await call(`/projects/${id}/diagnosis`, { focus: 'overall', objective: '保留现有品牌，优先修复任务阻断', roundId: round.id });
  expect(response.status).toBe(200);
  const { plan } = response.data;
  expect(plan.markdown).toContain('诊断验证项目');
  expect(plan.markdown).toContain('保留现有品牌');
  expect(plan.markdown).toContain(round.result.violations[0].what);
  expect(plan.markdown).toContain('React');
  expect(plan.markdown).toContain('尚未执行');
  expect(plan.pendingChecks).toBeGreaterThan(81);
  expect((await call(`/projects/${id}/diagnosis`)).data.plans[0].id).toBe(plan.id);
  expect(await hashes()).toEqual(before);
  expect(JSON.stringify(await getRound(id, round.id))).toBe(original);
});

it('includes manual motion observations and respects existing human decisions', async () => {
  const observation = await call(`/projects/${id}/observations`, { name: '动画无法中断', detail: '连续开关两次后回到旧状态。', location: '/drawer', domain: 'experience' });
  const issue = observation.data.workflow.observations[0];
  await call(`/projects/${id}/issue-workflow`, { roundId: round.id, fingerprint: issue.fingerprint, state: 'accepted', note: '此行为是当前原型约定，等待产品决定。' });
  const result = await call(`/projects/${id}/diagnosis`, { roundId: round.id, focus: 'motion' });
  expect(result.data.plan.markdown).toContain('动画无法中断');
  expect(result.data.plan.markdown).toContain('人工观察');
  expect(result.data.plan.markdown).toContain('先复核已有理由和证据，不自动要求重新修改');
  expect(result.data.plan.markdown).toContain('此行为是当前原型约定');
});

it('rejects unknown focuses and missing evidence instead of fabricating a successful diagnosis', async () => {
  expect((await call(`/projects/${id}/diagnosis`, { focus: 'unknown' })).status).toBe(400);
  expect((await call(`/projects/${id}/diagnosis`, { focus: 'overall', roundId: 'missing' })).status).toBe(404);
  const knowledge = (await call('/quality')).data;
  expect(knowledge.focuses).toHaveLength(10);
  expect(knowledge.scenarioChecks).toBe(81);
});

it('provides the same diagnosis capability to MCP agents without a separate Skill directory', async () => {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'diagnose_quality', arguments: { focus: 'resilience', objective: '核对失败后恢复' } } },
  ];
  const output = await mcp(messages);
  expect(output[0].result.tools.some((tool: { name: string }) => tool.name === 'diagnose_quality')).toBe(true);
  expect(output[1].result.content[0].text).toContain('边界状态与恢复');
  expect(output[1].result.content[0].text).toContain('核对失败后恢复');
  expect(output[1].result.content[0].text).not.toMatch(/Impeccable|Kowalski|Pro Max/);
});

it('persists per-task evidence and history without modifying the original plan, round or project', async () => {
  const { data: { plan } } = await call(`/projects/${id}/diagnosis`, { focus: 'motion', roundId: round.id });
  expect(new Set(plan.tasks.map((task: { id: string }) => task.id)).size).toBe(plan.pendingChecks);
  const path = join(home, 'projects', id, 'diagnoses', `${plan.id}.json`);
  const planBefore = await readFile(path, 'utf8'), projectBefore = await hashes(), roundBefore = JSON.stringify(await getRound(id, round.id));
  const endpoint = `/projects/${id}/diagnosis/${plan.id}/verification`;
  const initial = (await call(endpoint)).data;
  expect(initial.summary.pending).toBe(plan.tasks.length);
  expect(initial.summary.passed).toBe(0);
  const note = '390px，连续打开关闭三次，状态正确；证据 /evidence/drawer.png';
  const first = await call(endpoint, { taskId: plan.tasks[0].id, status: 'passed', note });
  expect(first.status).toBe(200);
  expect(first.data.summary.passed).toBe(1);
  const second = await call(endpoint, { taskId: plan.tasks[0].id, status: 'failed', note: '加入返回操作后复现了旧状态，待修复。' });
  expect(second.data.summary.passed).toBe(0);
  expect(second.data.summary.failed).toBe(1);
  const skipped = await call(endpoint, { taskId: plan.tasks[1].id, status: 'not-applicable', note: '当前页面没有此类手势操作。' });
  expect(skipped.data.summary['not-applicable']).toBe(1);
  expect(skipped.data.summary.pending).toBe(plan.tasks.length - 2);
  const loaded = (await call(endpoint)).data;
  expect(loaded.verification.events).toHaveLength(3);
  expect(loaded.verification.events[0].note).toBe(note);
  expect(loaded.markdown).toContain('非自动检测结论');
  expect(loaded.markdown).toContain('加入返回操作后复现了旧状态');
  const reset = await call(endpoint, { taskId: plan.tasks[0].id, status: 'pending', note: '代码发生变化，需要按原步骤重新验证。' });
  expect(reset.data.summary.failed).toBe(0);
  expect(reset.data.summary.pending).toBe(plan.tasks.length - 1);
  expect(reset.data.verification.events).toHaveLength(4);
  expect(await readFile(path, 'utf8')).toBe(planBefore);
  expect(await hashes()).toEqual(projectBefore);
  expect(JSON.stringify(await getRound(id, round.id))).toBe(roundBefore);
});

it('rejects unsupported states, empty evidence, unknown tasks and cross-project plan access', async () => {
  const { data: { plan } } = await call(`/projects/${id}/diagnosis`, { focus: 'hierarchy' });
  const endpoint = `/projects/${id}/diagnosis/${plan.id}/verification`;
  for (const input of [{ taskId: plan.tasks[0].id, status: 'passed', note: '' }, { taskId: plan.tasks[0].id, status: 'all-passed', note: 'x' }, { taskId: 'unknown', status: 'failed', note: 'x' }, { taskId: plan.tasks[0].id, status: 'pending', note: 'x'.repeat(4001) }]) {
    expect((await call(endpoint, input)).status).toBe(400);
  }
  expect((await call(endpoint)).data.verification.events).toEqual([]);
  const other = await addProject(resolve('examples'), '另一个项目');
  expect((await call(`/projects/${other.id}/diagnosis/${plan.id}/verification`)).status).toBe(404);
  expect((await call(`/projects/${id}/diagnosis/not-a-plan/verification`)).status).toBe(404);
});

it('keeps legacy text-only plans readable without inventing verification tasks or results', async () => {
  const { data: { plan } } = await call(`/projects/${id}/diagnosis`, { focus: 'task' });
  delete plan.tasks;
  const path = join(home, 'projects', id, 'diagnoses', `${plan.id}.json`);
  await writeFile(path, JSON.stringify(plan));
  const before = await readFile(path, 'utf8'), endpoint = `/projects/${id}/diagnosis/${plan.id}/verification`;
  const result = await call(endpoint);
  expect(result.status).toBe(200);
  expect(result.data.summary.total).toBe(0);
  expect(result.data.markdown).toContain('旧版文字方案');
  expect((await call(endpoint, { taskId: 'forms-1', status: 'passed', note: '没有迁移验收状态' })).status).toBe(400);
  expect(await readFile(path, 'utf8')).toBe(before);
});

it('lets MCP read and record the same verification tasks with explicit evidence provenance', async () => {
  const { data: { plan } } = await call(`/projects/${id}/diagnosis`, { focus: 'motion' });
  const output = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'quality_verification', arguments: {} } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'quality_verification', arguments: { plan: plan.id } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'quality_verification', arguments: { plan: plan.id, task: plan.tasks[0].id, status: 'failed', note: '测试页面快速开关后仍停留在展开状态。' } } },
  ]);
  expect(JSON.parse(output[0].result.content[0].text).some((item: { id: string }) => item.id === plan.id)).toBe(true);
  expect(JSON.parse(output[1].result.content[0].text).tasks).toEqual(plan.tasks);
  const recorded = JSON.parse(output[2].result.content[0].text);
  expect(recorded.summary.failed).toBe(1);
  expect(recorded.verification.events[0].via).toBe('mcp');
  expect((await call(`/projects/${id}/diagnosis/${plan.id}/verification`)).data.verification).toEqual(recorded.verification);
});
