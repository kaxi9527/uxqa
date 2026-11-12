import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { agentPreviewActive, agentPreviewPages, closeAgentPreview, openAgentPreviews } from '../src/ui/agent-preview.js';
import { addProject, updateProject } from '../src/ui/store.js';
import { writeAiSettings } from '../src/ai/model.js';
import { getProjectAgent, startProjectAgent, stopProjectAgents } from '../src/ui/project-agent.js';

it('runs the original and two isolated, interactive style alternatives without writing project data', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-preview-home-'));
  const root = await mkdtemp(join(tmpdir(), 'uxqa-preview-project-'));
  const previousHome = process.env.UXQA_HOME;
  process.env.UXQA_HOME = home;
  let writes = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { writes++; response.end(); return; }
    response.setHeader('content-type', 'text/html');
    response.end('<div id="source"><button id="action" style="padding:4px" onclick="this.textContent=\'Clicked\';localStorage.setItem(\'fixture\',\'written\');fetch(\'/write\',{method:\'POST\'}).catch(()=>{})">Button</button><span id="label">Old</span></div><div id="toolbar"></div>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const added = await addProject(root, 'Preview fixture');
    const entry = await updateProject(added.id, { pages: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, routes: ['/'], discover: false } });
    const input = { route: '/', selector: 'button', variants: [{ name: 'Compact', styles: { padding: '8px' } }, { name: 'Spacious', styles: { padding: '24px' } }] };
    await expect(openAgentPreviews(entry, { ...input, variants: [{ name: 'A', styles: { background: 'url(https://example.com)' } }, input.variants[1]] }, { headless: true })).rejects.toThrow('不支持');
    const result = await openAgentPreviews(entry, input, { headless: true });
    expect(result.variants).toEqual(['Original', 'Compact', 'Spacious']);
    expect(agentPreviewActive(entry.id)).toBe(true);
    const pages = agentPreviewPages(entry.id);
    expect(pages).toHaveLength(3);
    expect(await Promise.all(pages.map((page) => page.locator('button').evaluate((element) => getComputedStyle(element).paddingTop)))).toEqual(['4px', '8px', '24px']);
    await pages[1].locator('button').click();
    expect(await pages[1].locator('button').textContent()).toBe('Clicked');
    expect(await pages[0].evaluate(() => localStorage.getItem('fixture'))).toBe(null);
    expect(await pages[2].evaluate(() => localStorage.getItem('fixture'))).toBe(null);
    await pages[1].waitForTimeout(100);
    expect(writes).toBe(0);
    await expect(openAgentPreviews(entry, input, { headless: true })).rejects.toThrow('仍在打开');
    await closeAgentPreview(entry.id);
    expect(agentPreviewActive(entry.id)).toBe(false);
    const multi = { route: '/', selector: '#action', variants: [
      { name: 'Move', changes: [{ selector: '#label', text: 'New label', styles: { color: 'rgb(255, 0, 0)' } }, { selector: '#action', styles: { padding: '12px' } }], moves: [{ selector: '#action', destination: '#toolbar', position: 'append' }] },
      { name: 'Keep', changes: [{ selector: '#label', text: 'Second label' }] },
    ] };
    const compared = await openAgentPreviews(entry, multi, { headless: true });
    expect(compared.proposals[0].moves[0].destination).toBe('#toolbar');
    const comparedPages = agentPreviewPages(entry.id);
    expect(await comparedPages[0].locator('#source > #action').count()).toBe(1);
    expect(await comparedPages[1].locator('#toolbar > #action').count()).toBe(1);
    expect(await comparedPages[1].locator('#label').textContent()).toBe('New label');
    expect(await comparedPages[1].locator('#label').evaluate((element) => getComputedStyle(element).color)).toBe('rgb(255, 0, 0)');
    expect(await comparedPages[2].locator('#label').textContent()).toBe('Second label');
    await comparedPages[1].locator('#action').click();
    expect(await comparedPages[1].locator('#action').textContent()).toBe('Clicked');
    expect(await comparedPages[2].evaluate(() => localStorage.getItem('fixture'))).toBe(null);
    await closeAgentPreview(entry.id);
    await expect(openAgentPreviews(entry, { ...multi, variants: [{ name: 'Invalid', changes: [{ selector: '#source', text: 'would remove children' }] }, multi.variants[1]] }, { headless: true })).rejects.toThrow('不含子元素');
    expect(agentPreviewActive(entry.id)).toBe(false);
  } finally {
    const projects = await import('../src/ui/store.js').then((store) => store.listProjects());
    await Promise.all(projects.map((project) => closeAgentPreview(project.id)));
    await new Promise<void>((done) => server.close(() => done()));
    if (previousHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('stops the agent after opening alternatives and preserves the chosen proposal for the next turn', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-preview-agent-home-'));
  const root = await mkdtemp(join(tmpdir(), 'uxqa-preview-agent-project-'));
  const previousHome = process.env.UXQA_HOME, previousHeadless = process.env.UXQA_TEST_PREVIEW_HEADLESS;
  process.env.UXQA_HOME = home;
  process.env.UXQA_TEST_PREVIEW_HEADLESS = '1';
  const actions: object[] = [], calls: string[] = [];
  const pageServer = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<button>Original</button>'); });
  const model = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk; calls.push(body);
    response.setHeader('content-type', 'application/json');
    const action = (actions.shift() ?? { type: 'answer', text: 'Done' }) as Record<string, unknown>;
    if ((action.type === 'replace' || action.type === 'create') && !Object.hasOwn(action, 'reason')) action.reason = 'Apply the selected page alternative';
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }));
  });
  await new Promise<void>((done) => pageServer.listen(0, '127.0.0.1', done));
  await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'preview-fixture' }));
    await writeFile(join(root, 'page.css'), 'button { padding: 4px; }');
    const added = await addProject(root, 'Preview agent fixture');
    const entry = await updateProject(added.id, { pages: { baseUrl: `http://127.0.0.1:${(pageServer.address() as { port: number }).port}`, routes: ['/'], discover: false } });
    await writeAiSettings({ mode: 'api', protocol: 'openai', connection: 'direct', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`, model: 'fixture', passes: 1, verify: false, discover: false, maxCalls: 8 });
    actions.push({ type: 'read', path: 'page.css' }, { type: 'preview_variants', route: '/', selector: 'button', variants: [{ name: 'A', styles: { padding: '8px' } }, { name: 'B', styles: { padding: '24px' } }] }, { type: 'replace', path: 'page.css', search: '4px', replace: '8px' });
    await startProjectAgent(entry, { text: 'Compare alternatives' });
    let state = await getProjectAgent(entry.id);
    for (let i = 0; state.running && i < 200; i++) { await new Promise((done) => setTimeout(done, 25)); state = await getProjectAgent(entry.id); }
    expect(state.running).toBe(false);
    expect(state.previewActive).toBe(true);
    expect(calls).toHaveLength(2);
    expect(state.messages.at(-1)?.text).toContain('告诉我你的选择');
    expect(await readFile(join(root, 'page.css'), 'utf8')).toContain('4px');
    actions.length = 0;
    actions.push({ type: 'read', path: 'page.css' }, { type: 'replace', path: 'page.css', search: '4px', replace: '24px' }, { type: 'answer', text: 'Applied B.' });
    await startProjectAgent(entry, { text: 'Use B' });
    for (let i = 0; i < 200; i++) { state = await getProjectAgent(entry.id); if (!state.running) break; await new Promise((done) => setTimeout(done, 25)); }
    expect(calls[2]).toContain('proposals');
    expect(calls[2]).toContain('24px');
    expect(await readFile(join(root, 'page.css'), 'utf8')).toContain('24px');
  } finally {
    await stopProjectAgents();
    await new Promise<void>((done) => model.close(() => done()));
    await new Promise<void>((done) => pageServer.close(() => done()));
    if (previousHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previousHome;
    if (previousHeadless === undefined) delete process.env.UXQA_TEST_PREVIEW_HEADLESS; else process.env.UXQA_TEST_PREVIEW_HEADLESS = previousHeadless;
    await rm(home, { recursive: true, force: true }); await rm(root, { recursive: true, force: true });
  }
}, 30_000);
