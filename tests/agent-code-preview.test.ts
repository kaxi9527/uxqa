import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { writeAiSettings } from '../src/ai/model.js';
import { agentPreviewActive, agentPreviewPages, closeAgentPreview } from '../src/ui/agent-preview.js';
import { inspectPreviewResource, openAgentCodePreviews, prepareCodePreview, type PreviewResources } from '../src/ui/agent-preview-code.js';
import { getProjectAgent, startProjectAgent, stopProjectAgents } from '../src/ui/project-agent.js';
import { startConsole } from '../src/ui/server.js';
import { addProject, updateProject } from '../src/ui/store.js';

it('runs reviewed resource alternatives through stateful rerenders without writing project source or importing login state', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-code-preview-home-'));
  const root = await mkdtemp(join(tmpdir(), 'uxqa-code-preview-project-'));
  const previousHome = process.env.UXQA_HOME;
  process.env.UXQA_HOME = home;
  let writes = 0, external = 0, redirects = 0, sensitiveReads = 0, revision = '';
  const outsider = createServer((_request, response) => { external++; response.end('unexpected'); });
  await new Promise<void>((done) => outsider.listen(0, '127.0.0.1', done));
  const externalUrl = `http://127.0.0.1:${(outsider.address() as { port: number }).port}/leak`;
  const stylesheet = '#count { padding: 4px; }';
  const source = `let count=0;function render(){const root=document.querySelector('#app');root.innerHTML='<button id="count">Count '+count+'</button>';root.querySelector('button').onclick=()=>{count++;render();fetch('/write',{method:'POST'}).catch(()=>{});fetch('/redirect.js').catch(()=>{});fetch(${JSON.stringify(externalUrl)}).catch(()=>{});};}render();`;
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { writes++; response.end('unexpected'); return; }
    if (request.url === '/.env') { sensitiveReads++; response.setHeader('content-type', 'text/javascript'); response.end('blocked'); return; }
    if (request.url === '/embedded.js') { response.setHeader('content-type', 'text/javascript'); response.end(`const key='sk-proj-${'A'.repeat(40)}'`); return; }
    if (request.url === '/app.js' || request.url === '/unused.js') { response.setHeader('content-type', 'text/javascript'); response.setHeader('content-encoding', 'gzip'); response.end(gzipSync(source + revision)); return; }
    if (request.url === '/style.css') { response.setHeader('content-type', 'text/css'); response.end(stylesheet); return; }
    if (request.url === '/redirect.js') { redirects++; response.writeHead(302, { location: externalUrl }); response.end(); return; }
    response.setHeader('content-type', 'text/html');
    response.end('<link rel="stylesheet" href="/style.css"><h1>Fixture</h1><main id="app"></main><script type="module" src="/app.js"></script>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const sourceFile = join(root, 'project.js');
    await writeFile(sourceFile, source);
    await writeFile(join(root, 'style.css'), stylesheet);
    const stateFile = join(home, 'state.json');
    await writeFile(stateFile, JSON.stringify({ cookies: [{ name: 'private_fixture', value: 'do-not-import', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] }));
    const added = await addProject(root, 'Code preview fixture');
    const entry = await updateProject(added.id, { pages: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, storageState: stateFile, routes: ['/'], discover: false } });
    const resources: PreviewResources = new Map(), signal = new AbortController().signal;
    await expect(inspectPreviewResource(entry, '/.%65nv', 0, resources, signal)).rejects.toThrow('路径不允许访问');
    await expect(inspectPreviewResource(entry, '/src/id_rsa', 0, resources, signal)).rejects.toThrow('路径不允许访问');
    await expect(inspectPreviewResource(entry, '/embedded.js', 0, resources, signal)).rejects.toThrow('疑似凭据');
    expect(sensitiveReads).toBe(0);
    await expect(inspectPreviewResource(entry, '/redirect.js', 0, resources, signal)).rejects.toThrow('无法读取');
    await inspectPreviewResource(entry, '/app.js', 0, resources, signal);
    await inspectPreviewResource(entry, '/style.css', 0, resources, signal);
    const search = '<button id="count">Count ';
    const input = { route: '/', selector: '#app', variants: [
      { name: 'Card', patches: [{ resource: '/app.js', search, replace: '<section class="card"><button id="count">Card ' }, { resource: '/style.css', search: 'padding: 4px', replace: 'padding: 16px' }] },
      { name: 'Panel', patches: [{ resource: '/app.js', search, replace: '<aside class="panel"><button id="count">Panel ' }] },
    ] };
    expect(() => prepareCodePreview(entry, input, new Map())).toThrow('实际读取');
    expect(() => prepareCodePreview(entry, { ...input, variants: [{ name: 'A', patches: [{ resource: '/app.js', search: 'count', replace: 'x' }] }, input.variants[1]] }, resources)).toThrow('唯一');
    const plan = prepareCodePreview(entry, input, resources);
    const result = await openAgentCodePreviews(entry, plan, { headless: true, signal });
    expect(result.variants.map((variant) => variant.applied)).toEqual([0, 2, 1]);
    const pages = agentPreviewPages(entry.id);
    expect(await pages[0].locator('#count').textContent()).toBe('Count 0');
    expect(await pages[1].locator('section.card #count').textContent()).toBe('Card 0');
    expect(await pages[1].locator('#count').evaluate((element) => getComputedStyle(element).paddingTop)).toBe('16px');
    expect(await pages[0].locator('#count').evaluate((element) => getComputedStyle(element).paddingTop)).toBe('4px');
    expect(await pages[2].locator('aside.panel #count').textContent()).toBe('Panel 0');
    expect(await pages[1].evaluate(() => document.cookie)).not.toContain('private_fixture');
    const failed: string[] = [];
    pages[1].on('requestfailed', (request) => { failed.push(new URL(request.url()).pathname); });
    redirects = 0;
    await pages[1].locator('#count').click();
    expect(await pages[1].locator('section.card #count').textContent()).toBe('Card 1');
    expect(await pages[2].locator('aside.panel #count').textContent()).toBe('Panel 0');
    await expect.poll(() => failed.sort()).toEqual(['/leak', '/redirect.js', '/write']);
    expect(redirects).toBe(1);
    expect(writes).toBe(0);
    expect(external).toBe(0);
    expect(await readFile(sourceFile, 'utf8')).toBe(source);
    expect(await readFile(join(root, 'style.css'), 'utf8')).toBe(stylesheet);
    await closeAgentPreview(entry.id);
    revision = '\n// changed';
    await expect(openAgentCodePreviews(entry, plan, { headless: true, signal })).rejects.toThrow('资源已变化');
    expect(agentPreviewActive(entry.id)).toBe(false);
    revision = '';
    await inspectPreviewResource(entry, '/unused.js', 0, resources, signal);
    const missing = prepareCodePreview(entry, { ...input, variants: [{ name: 'Missing', patches: [{ resource: '/unused.js', search, replace: 'unused' }] }, input.variants[1]] }, resources);
    await expect(openAgentCodePreviews(entry, missing, { headless: true, signal })).rejects.toThrow('未在页面加载时请求');
    expect(agentPreviewActive(entry.id)).toBe(false);
    const broken = prepareCodePreview(entry, { ...input, selector: 'body', variants: [{ name: 'Broken', patches: [{ resource: '/app.js', search, replace: "'; syntax error !!!" }] }, input.variants[1]] }, resources);
    const brokenResult = await openAgentCodePreviews(entry, broken, { headless: true, signal });
    expect(brokenResult.status).toBe('opened-with-errors');
    expect(brokenResult.variants[1].runtimeErrors).toBeGreaterThan(0);
    await closeAgentPreview(entry.id);
  } finally {
    const projects = await import('../src/ui/store.js').then((store) => store.listProjects());
    await Promise.all(projects.map((project) => closeAgentPreview(project.id)));
    await new Promise<void>((done) => server.close(() => done()));
    await new Promise<void>((done) => outsider.close(() => done()));
    if (previousHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previousHome;
    await rm(home, { recursive: true, force: true }); await rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('prepares a reviewable plan in project chat, waits for the user, then returns the selected direction to source repair', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-code-chat-home-'));
  const root = await mkdtemp(join(tmpdir(), 'uxqa-code-chat-project-'));
  const previousHome = process.env.UXQA_HOME, previousHeadless = process.env.UXQA_TEST_PREVIEW_HEADLESS;
  process.env.UXQA_HOME = home; process.env.UXQA_TEST_PREVIEW_HEADLESS = '1';
  const actions: object[] = [], calls: string[] = [];
  const source = `let count=0;function render(){document.querySelector('#app').innerHTML='<button id="count">Count '+count+'</button>';document.querySelector('#count').onclick=()=>{count++;render()};}render();`;
  const servedBase = source + '\n// served-resource-fixture-marker';
  let pageLoads = 0, served = servedBase, slow = false;
  const site = createServer((request, response) => {
    if (request.url === '/app.js') {
      response.setHeader('content-type', 'text/javascript');
      if (slow) { const timer = setTimeout(() => response.end(served), 5000); response.on('close', () => clearTimeout(timer)); }
      else response.end(served);
      return;
    }
    pageLoads++; response.setHeader('content-type', 'text/html'); response.end('<main id="app"></main><script type="module" src="/app.js"></script>');
  });
  const model = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk; calls.push(body);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions.shift() ?? { type: 'answer', text: 'Done.' }) } }] }));
  });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
  let ui: Awaited<ReturnType<typeof startConsole>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await writeFile(join(home, 'access-settings.json'), JSON.stringify({ locale: 'en', onboardingDone: true, checks: [] }));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'code-preview-chat-fixture' }));
    await writeFile(join(root, 'app.js'), source);
    const added = await addProject(root, 'Code preview chat fixture');
    const entry = await updateProject(added.id, { pages: { baseUrl: `http://127.0.0.1:${(site.address() as { port: number }).port}`, routes: ['/'], discover: false } });
    await writeAiSettings({ mode: 'api', protocol: 'openai', connection: 'direct', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`, model: 'fixture', passes: 1, verify: false, discover: false, maxCalls: 8 });
    const search = '<button id="count">Count ';
    actions.push({ type: 'read_preview_resource', resource: '/app.js' }, { type: 'read', path: 'app.js' }, { type: 'read_preview_resource', resource: '/app.js' }, { type: 'prepare_code_preview', route: '/', selector: '#app', variants: [{ name: 'Card', patches: [{ resource: '/app.js', search, replace: '<section><button id="count">Card ' }] }, { name: 'Panel', patches: [{ resource: '/app.js', search, replace: '<aside><button id="count">Panel ' }] }] }, { type: 'replace', path: 'app.js', search: 'Count ', replace: 'unexpected', reason: 'Must wait for user choice' });
    await startProjectAgent(entry, { text: 'Compare two functional layouts' });
    let state = await getProjectAgent(entry.id);
    for (let i = 0; state.running && i < 300; i++) { await new Promise((done) => setTimeout(done, 30)); state = await getProjectAgent(entry.id); }
    expect(state.running).toBe(false);
    expect(state.messages.some((item) => item.kind === 'code-preview-plan')).toBe(true);
    expect(calls).toHaveLength(4);
    expect(state.messages.some((item) => item.status === 'error' && item.text.includes('Inspect the existing implementation'))).toBe(true);
    expect(calls[3]).toContain('served-resource-fixture-marker');
    expect(pageLoads).toBe(0);
    expect(agentPreviewActive(entry.id)).toBe(false);
    expect(await readFile(join(root, 'app.js'), 'utf8')).toBe(source);
    ui = await startConsole({ port: 0 }); browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(ui.url); await page.getByRole('tab', { name: 'Repair chat', exact: true }).click();
    await page.getByText('Code alternatives prepared; review before opening').waitFor();
    await page.getByText(/Card · 1 resource change/).click();
    await page.getByText(/<section><button id="count">Card/).waitFor();
    await page.getByRole('region', { name: 'Original code' }).waitFor();
    await page.getByRole('region', { name: 'Candidate code' }).waitFor();
    served = servedBase + '\n// changed after review';
    await page.getByRole('button', { name: 'Run code alternatives' }).click();
    await page.getByText('The preview resource changed. Prepare the code alternatives again.').waitFor({ timeout: 30_000 });
    expect(agentPreviewActive(entry.id)).toBe(false);
    served = servedBase;
    slow = true;
    await page.getByRole('button', { name: 'Run code alternatives' }).click();
    await page.getByRole('button', { name: 'Cancel opening alternatives' }).click();
    await page.getByText('Code preview cancelled; comparison is not confirmed.').waitFor({ timeout: 30_000 });
    expect(agentPreviewActive(entry.id)).toBe(false);
    slow = false;
    await page.getByRole('button', { name: 'Run code alternatives' }).click();
    await page.getByText('Code alternatives opened in the browser; compare them and check interactions.').waitFor({ timeout: 30_000 });
    expect(agentPreviewActive(entry.id)).toBe(true);
    expect(agentPreviewPages(entry.id)).toHaveLength(3);
    await agentPreviewPages(entry.id)[2].locator('#count').click();
    expect(await agentPreviewPages(entry.id)[2].locator('aside #count').textContent()).toBe('Panel 1');
    await page.getByRole('button', { name: 'Close previews' }).click();
    await page.getByRole('button', { name: 'Close previews' }).waitFor({ state: 'hidden' });
    expect(agentPreviewActive(entry.id)).toBe(false);
    actions.length = 0;
    actions.push({ type: 'read', path: 'app.js' }, { type: 'replace', path: 'app.js', search: 'Count ', replace: 'Panel ', reason: 'Apply the selected layout' }, { type: 'answer', text: 'Selected direction implemented.' });
    await startProjectAgent(entry, { text: 'Use Panel' });
    for (let i = 0; i < 300; i++) { state = await getProjectAgent(entry.id); if (!state.running) break; await new Promise((done) => setTimeout(done, 30)); }
    expect(calls[4]).toContain('Panel');
    expect(await readFile(join(root, 'app.js'), 'utf8')).toContain('Panel ');
    await page.close();
  } finally {
    await browser?.close(); await ui?.close(); await stopProjectAgents();
    await new Promise<void>((done) => site.close(() => done())); await new Promise<void>((done) => model.close(() => done()));
    if (previousHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previousHome;
    if (previousHeadless === undefined) delete process.env.UXQA_TEST_PREVIEW_HEADLESS; else process.env.UXQA_TEST_PREVIEW_HEADLESS = previousHeadless;
    await rm(home, { recursive: true, force: true }); await rm(root, { recursive: true, force: true });
  }
}, 60_000);
