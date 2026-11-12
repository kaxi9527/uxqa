import { createServer } from 'node:http';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { writeAiSettings } from '../src/ai/model.js';
import { addProject } from '../src/ui/store.js';
import { getProjectAgent, startProjectAgent, stopProjectAgents } from '../src/ui/project-agent.js';
import { startConsole } from '../src/ui/server.js';
import { cleanExportedScreenshots } from '../src/ui/exported-screenshot-retention.js';

it('plans against the native catalog, requires review, and runs the existing verified sync workflow', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-component-agent-home-'));
  const root = await mkdtemp(join(tmpdir(), 'uxqa-component-agent-project-'));
  const previousHome = process.env.UXQA_HOME;
  process.env.UXQA_HOME = home;
  const actions: Array<Record<string, unknown>> = [], calls: string[] = [];
  const fixture = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<button onclick="document.querySelector(\'p\').hidden=false">Show</button><p hidden>Record</p>');
  });
  const model = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk; calls.push(body);
    const action = actions.shift() ?? { type: 'answer', text: 'Done.' };
    if (action.planId === 'from-context') {
      const text = JSON.parse(body).messages[0].content[0].text as string;
      action.planId = text.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/)?.[0];
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }));
  });
  await new Promise<void>((done) => fixture.listen(0, '127.0.0.1', done));
  await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
  let ui: Awaited<ReturnType<typeof startConsole>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await writeFile(join(home, 'access-settings.json'), JSON.stringify({ locale: 'en', onboardingDone: true, checks: [] }));
    await mkdir(join(root, 'src', 'component-library'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture-product', scripts: { test: 'node check.cjs # PRIVATE_SCRIPT_MARKER', typecheck: 'node typecheck.cjs' } }));
    await writeFile(join(root, 'check.cjs'), `const fs=require('fs');if(!fs.readFileSync('src/component-library/Card.tsx','utf8').includes('Card'))process.exit(1);fs.writeFileSync(${JSON.stringify(join(home, 'test-ran'))},'yes')`);
    await writeFile(join(root, 'typecheck.cjs'), "if(!require('fs').readFileSync('src/Page.tsx','utf8').includes('<Card'))process.exit(1)");
    await writeFile(join(root, 'src', 'component-library', 'component-manifest.json'), JSON.stringify({ components: [] }));
    await writeFile(join(root, 'src', 'Page.tsx'), "import { Card } from './component-library/Card'; export function Page(){return <Card/>}");
    const scenario = JSON.stringify({ baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}`, viewports: [{ name: 'desktop', width: 1200, height: 800 }], options: { axe: false }, flows: [{ name: 'show record', steps: [{ action: 'click', target: { role: 'button', name: 'Show' } }, { action: 'expectVisible', target: { text: 'Record' } }] }] });
    await writeFile(join(root, 'qa.json'), scenario);
    const project = await addProject(root, 'Component fixture');
    await writeAiSettings({ mode: 'api', protocol: 'openai', connection: 'direct', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`, model: 'fixture', passes: 1, verify: false, discover: false, maxCalls: 8 });
    const definition = { productId: 'fixture-product', id: 'card', name: 'Card', description: 'Record card', implementation: ['src/component-library/Card.tsx'], consumers: ['src/Page.tsx'], states: ['default'], variants: [], anatomy: ['body'], behavior: ['show record'], accessibility: ['keyboard'], usage: ['records'], antiUsage: [], props: [], verification: { testScript: 'test', typecheckScript: 'typecheck', qaConfig: 'qa.json' } };
    actions.push({ type: 'read', path: 'src/component-library/component-manifest.json' }, { type: 'replace', path: 'src/component-library/component-manifest.json', search: '[]', replace: '[{"id":"fake","name":"Fake"}]', reason: 'Attempt direct catalog edit' }, { type: 'answer', text: 'Catalog must be synchronized.' });
    await startProjectAgent(project, { text: 'Try editing the catalog directly' });
    let state = await getProjectAgent(project.id);
    for (let i = 0; state.running && i < 200; i++) { await new Promise((done) => setTimeout(done, 25)); state = await getProjectAgent(project.id); }
    expect(state.messages.some((item) => item.status === 'error' && item.text.includes('Update the component catalog'))).toBe(true);
    expect(JSON.parse(await readFile(join(root, 'src', 'component-library', 'component-manifest.json'), 'utf8')).components).toHaveLength(0);
    actions.push({ type: 'list', path: 'src' }, { type: 'create', path: 'src/component-library/Card.tsx', content: 'export function Card(){ return <article>Record</article>; }', reason: 'Implement the requested card' }, { type: 'answer', text: 'Plan required.' });
    await startProjectAgent(project, { text: 'Try creating a shared component' });
    state = await getProjectAgent(project.id);
    for (let i = 0; state.running && i < 200; i++) { await new Promise((done) => setTimeout(done, 25)); state = await getProjectAgent(project.id); }
    await expect(access(join(root, 'src', 'component-library', 'Card.tsx'))).rejects.toMatchObject({ code: 'ENOENT' });
    actions.push({ type: 'list', path: '' }, { type: 'component_plan', definition }, { type: 'create', path: 'src/component-library/Card.tsx', planId: 'from-context', content: 'export function Card(){ return <article>Record</article>; }', reason: 'Implement the planned card' }, { type: 'answer', text: 'Ready for review.' });
    await startProjectAgent(project, { text: 'Plan and implement the card' });
    for (let i = 0; i < 200; i++) { state = await getProjectAgent(project.id); if (!state.running) break; await new Promise((done) => setTimeout(done, 25)); }
    expect(state.messages.some((item) => item.kind === 'component-plan'), JSON.stringify(state.messages.map(({ role, text }) => ({ role, text })))).toBe(true);
    expect(await readFile(join(root, 'src', 'component-library', 'Card.tsx'), 'utf8')).toContain('function Card');
    await expect(access(join(home, 'test-ran'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(calls.join('\n')).not.toContain('PRIVATE_SCRIPT_MARKER');
    ui = await startConsole({ port: 0 });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(ui.url);
    await page.getByRole('tab', { name: 'Repair chat', exact: true }).click();
    await page.getByText('Component plan prepared; not yet verified or synchronized').waitFor();
    await page.getByText(/PRIVATE_SCRIPT_MARKER/).waitFor();
    await page.getByText(/View browser scenario/).click();
    await page.getByText(/show record/).waitFor();
    await writeFile(join(root, 'qa.json'), scenario + ' ');
    await page.getByRole('button', { name: 'Run checks and synchronize' }).click();
    await page.getByText(/Component verification did not complete/).waitFor({ timeout: 15_000 });
    await expect(access(join(home, 'test-ran'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(root, 'src', 'component-library', 'component-manifest.json'), 'utf8')).components).toHaveLength(0);
    await writeFile(join(root, 'qa.json'), scenario);
    await page.getByRole('button', { name: 'Run checks and synchronize' }).click();
    await page.getByText('Component verification and catalog synchronization completed').waitFor({ timeout: 60_000 });
    expect(JSON.parse(await readFile(join(root, 'src', 'component-library', 'component-manifest.json'), 'utf8')).components[0].name).toBe('Card');
    expect(await readFile(join(home, 'test-ran'), 'utf8')).toBe('yes');
    expect((await readdir(join(home, 'screenshot-runs'))).length).toBeGreaterThan(0);
    expect(await cleanExportedScreenshots(Date.now() + 1000)).toBeGreaterThan(0);
    expect(calls.join('\n')).not.toContain('PRIVATE_SCRIPT_MARKER');
    await page.close();
  } finally {
    await browser?.close(); await ui?.close(); await stopProjectAgents();
    await new Promise<void>((done) => model.close(() => done()));
    await new Promise<void>((done) => fixture.close(() => done()));
    if (previousHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previousHome;
    await rm(home, { recursive: true, force: true }); await rm(root, { recursive: true, force: true });
  }
}, 90_000);
