import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { writeAiSettings } from '../src/ai/model.js';
import { measureAgentMotion } from '../src/ui/agent-motion.js';
import { getProjectAgent, startProjectAgent, stopProjectAgents } from '../src/ui/project-agent.js';
import { addProject, updateProject } from '../src/ui/store.js';

it('records a real browser hover sample in the project repair conversation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-motion-home-'));
  const root = await mkdtemp(join(tmpdir(), 'uxqa-motion-project-'));
  const previousHome = process.env.UXQA_HOME;
  process.env.UXQA_HOME = home;
  let mutations = 0;
  const pageServer = createServer((request, response) => {
    if (request.method === 'POST') { mutations++; response.end('unexpected'); return; }
    response.setHeader('content-type', 'text/html');
    response.end(`<style>body{min-height:${request.url?.includes('noscroll') ? '100px' : '2400px'}}button{transition:transform 2s}button:hover,button.clicked{transform:translateX(8px)}@media (prefers-reduced-motion:reduce){button{transition:none}}</style><button onmouseenter="fetch('/write',{method:'POST'}).catch(()=>{})" onclick="this.classList.add('clicked');fetch('/write',{method:'POST'}).catch(()=>{})">Inspect</button>${request.url?.includes('covered') ? '<div style="position:fixed;inset:0;z-index:10"></div>' : ''}`);
  });
  const calls: string[] = [];
  const model = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    calls.push(body);
    const prompt = JSON.parse(body).messages[0].content[0].text as string;
    const measurementId = prompt.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/)?.[0];
    const action = calls.length === 1 ? { type: 'measure_motion', route: '/', selector: 'button' } : calls.length === 2 ? { type: 'measure_motion', route: '/', selector: 'button', baselineId: measurementId } : calls.length === 3 ? { type: 'measure_motion', route: '/', selector: 'button', baselineId: measurementId, reducedMotion: true } : { type: 'answer', text: 'Measurement recorded.' };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }));
  });
  await new Promise<void>((done) => pageServer.listen(0, '127.0.0.1', done));
  await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
  const pagePort = (pageServer.address() as { port: number }).port;
  const modelPort = (model.address() as { port: number }).port;
  try {
    const added = await addProject(root, 'Motion fixture');
    const project = await updateProject(added.id, { pages: { baseUrl: `http://127.0.0.1:${pagePort}`, routes: ['/'], discover: false } });
    await expect(measureAgentMotion(project, { route: '//example.com', selector: 'button' }, new AbortController().signal)).rejects.toThrow('项目内');
    await expect(measureAgentMotion(project, { route: '/', selector: 'button', trigger: 'click' }, new AbortController().signal)).rejects.toThrow('启用页面点击');
    const clickSample = await measureAgentMotion(project, { route: '/', selector: 'button', trigger: 'click', allowClick: true }, new AbortController().signal);
    expect(clickSample.trigger).toBe('click');
    expect(clickSample.frameIntervals).toBeGreaterThan(2);
    expect(clickSample.targetAnimations).toBeGreaterThan(0);
    expect(clickSample.mainThread).not.toBeNull();
    expect(clickSample.mainThread?.taskMs).toBeGreaterThanOrEqual(0);
    expect(clickSample.mainThread?.layoutCount).toBeGreaterThanOrEqual(0);
    const reduced = await measureAgentMotion(project, { route: '/', selector: 'button', trigger: 'click', allowClick: true, reducedMotion: true }, new AbortController().signal);
    expect(reduced.reducedMotion).toBe(true);
    expect(reduced.targetAnimations).toBe(0);
    const scrolled = await measureAgentMotion(project, { route: '/', selector: 'button', trigger: 'scroll' }, new AbortController().signal);
    expect(scrolled.scroll?.container).toBe('window');
    expect(scrolled.scroll?.delta).toBeGreaterThan(0);
    await expect(measureAgentMotion(project, { route: '/?noscroll', selector: 'button', trigger: 'scroll' }, new AbortController().signal)).rejects.toThrow('没有观察到实际滚动');
    const covered = await measureAgentMotion(project, { route: '/?covered', selector: 'button' }, new AbortController().signal).catch((error: Error) => error);
    expect(covered).toBeInstanceOf(Error);
    expect((covered as Error).message).toBe('无法在可见、稳定且未遮挡的元素上完成动效触发，请检查页面状态和选择器');
    await writeAiSettings({ mode: 'api', protocol: 'openai', connection: 'direct', baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: 'fixture', passes: 1, verify: false, discover: false, maxCalls: 5 });
    await startProjectAgent(project, { text: 'Measure this hover animation' });
    let state = await getProjectAgent(project.id);
    const deadline = Date.now() + 25_000;
    while (state.running && Date.now() < deadline) { await new Promise((done) => setTimeout(done, 100)); state = await getProjectAgent(project.id); }
    expect(state.running).toBe(false);
    const record = state.messages.find((item) => item.role === 'tool' && item.text.startsWith('动效实测'));
    expect(record).toBeDefined();
    const sample = record!.data as { status: string; route: string; selector: string; trigger: string; viewport: unknown; frameIntervals: number; observedAnimations: number; p95FrameMs: number; limitations: string };
    expect(sample).toMatchObject({ status: 'measured', route: '/', selector: 'button', trigger: 'hover', viewport: { width: 1440, height: 900 } });
    expect(sample.frameIntervals).toBeGreaterThan(2);
    expect(sample.observedAnimations).toBeGreaterThan(0);
    expect(sample.p95FrameMs).toBeGreaterThan(0);
    expect(sample.limitations).toContain('只覆盖本次指定的触发场景');
    const compared = state.messages.filter((item) => item.kind === 'motion').at(-1)?.data?.comparison as { medianDeltaMs: number; p95DeltaMs: number; mainThreadDelta: { taskMs: number } };
    expect(typeof compared?.medianDeltaMs).toBe('number');
    expect(typeof compared?.p95DeltaMs).toBe('number');
    expect(typeof compared?.mainThreadDelta?.taskMs).toBe('number');
    expect(state.messages.some((item) => item.status === 'error' && item.text.includes('动效偏好和滚动条件')), JSON.stringify(state.messages.map(({ role, text, status }) => ({ role, text, status })))).toBe(true);
    expect(mutations).toBe(0);
    expect(calls[1]).toContain('medianFrameMs');
  } finally {
    await stopProjectAgents();
    await new Promise<void>((done) => model.close(() => done()));
    await new Promise<void>((done) => pageServer.close(() => done()));
    if (previousHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
