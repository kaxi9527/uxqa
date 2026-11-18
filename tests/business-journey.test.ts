import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseJourney } from '../src/config.js';
import { runBusinessJourney } from '../src/business-journey.js';
import { runAudit } from '../src/runner.js';
import { writeAiSettings } from '../src/ai/model.js';
import { addProject, updateProject } from '../src/ui/store.js';
import { getProjectAgent, startProjectAgent, stopProjectAgents } from '../src/ui/project-agent.js';
import { startConsole } from '../src/ui/server.js';

const example = new URL('../examples/business-journeys/', import.meta.url);
const raw = JSON.parse(await readFile(new URL('scenario.json', example), 'utf8'));
const { createFixture } = await import(new URL('site.mjs', example).href) as { createFixture(fault?: string): Server };
async function listen(server: Server) {
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return 'http://127.0.0.1:' + (server.address() as { port: number }).port;
}
const close = (server: Server) => new Promise<void>(done => server.close(() => done()));

describe('business journeys', () => {
  it('runs both examples once across the viewport matrix and reports every phase as fixture evidence', async () => {
    const site = createFixture(), baseUrl = await listen(site);
    const outDir = await mkdtemp(join(tmpdir(), 'uxqa-journey-reports-'));
    try {
      const report = await runAudit(loadConfig({ ...raw, baseUrl }), { outDir });
      const checks = report.checks.filter(c => c.check === 'business-journey');
      expect(checks).toHaveLength(raw.journeys[0].phases.length + raw.journeys[1].phases.length);
      expect(checks.filter(c => c.status !== 'pass')).toEqual([]);
      expect(checks.every(c => c.dataNature === 'fixture' && c.requirement)).toBe(true);
    } finally { await close(site); await rm(outDir, { recursive: true, force: true }); }
  }, 45_000);

  it.each([
    ['stale', 0, 'Read target eligibility', 'fail', 'Eligible'],
    ['scope', 0, 'Register in the unchanged event', 'fail', '24 hours'],
    ['swapped', 1, 'A after confirmation', 'fail', 'missing ×1'],
    ['duplicate', 1, 'Organizer after confirmation', 'fail', 'extra ×1'],
    ['cancel', 1, 'B after cancellation', 'fail', 'extra ×1'],
    ['partial', 1, 'Capture original assignments', 'blocked', 'Full list unavailable'],
  ] as const)('identifies %s with the affected phase and evidence', async (fault, index, phase, status, detail) => {
    const site = createFixture(fault), baseUrl = await listen(site);
    try {
      const browser = await chromium.launch();
      try {
        const result = await runBusinessJourney(browser, baseUrl, parseJourney(raw.journeys[index]));
        expect(result.find(p => p.phase === phase)).toMatchObject({ status, detail: expect.stringContaining(detail) });
        if (fault === 'swapped') expect(result.find(p => p.phase === 'B after confirmation')?.status).toBe('fail');
        if (fault === 'partial') expect(result.at(-1)?.status).toBe('blocked');
      } finally { await browser.close(); }
    } finally { await close(site); }
  }, 30_000);

  it('rejects missing baselines and off-site routes before running actions', () => {
    const list = raw.journeys[1].phases.at(-1).list;
    const phase = { route: '/tasks', actor: 'reader', name: 'Compare', list };
    expect(() => parseJourney({ name: 'Check', requirement: 'Exact', phases: [phase] })).toThrow('earlier snapshot');
    expect(() => parseJourney({ name: 'Check', requirement: 'Exact', phases: [{ ...phase, route: '//example.org/' }] })).toThrow('project-relative');
  });

  it('binds the chat plan to a PRD excerpt and runs the reviewed plan from the project chat API', async () => {
    const site = createFixture();
    const baseUrl = await listen(site);
    const definition = { ...raw.journeys[1], gaps: ['A second stage was not available'] };
    const quote = definition.requirement;
    const actions: Record<string, unknown>[] = [
      { type: 'read', path: 'requirements.md' },
      { type: 'prepare_journey', path: 'requirements.md', search: 'invented quotation', definition },
      { type: 'prepare_journey', path: 'requirements.md', search: quote, definition },
      { type: 'answer', text: 'Ready to review.' },
    ];
    const model = createServer(async (req, res) => {
      for await (const _chunk of req) { /* Consume the model request. */ }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions.shift()) } }] }));
    });
    const modelUrl = await listen(model);
    const home = await mkdtemp(join(tmpdir(), 'uxqa-journey-chat-'));
    const root = await mkdtemp(join(tmpdir(), 'uxqa-journey-project-'));
    const previous = process.env.UXQA_HOME;
    process.env.UXQA_HOME = home;
    let ui: Awaited<ReturnType<typeof startConsole>> | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await writeFile(join(home, 'access-settings.json'), JSON.stringify({ locale: 'en', onboardingDone: true, checks: [] }));
      await writeFile(join(root, 'package.json'), '{"name":"test-project"}');
      await writeFile(join(root, 'requirements.md'), quote);
      const added = await addProject(root, 'Test project');
      const entry = await updateProject(added.id, { pages: { baseUrl, routes: ['/'], discover: false } });
      await writeAiSettings({ mode: 'api', protocol: 'openai', connection: 'direct', baseUrl: modelUrl + '/v1', model: 'fixture', passes: 1, verify: false, discover: false, maxCalls: 8 });
      const settled = async () => {
        await expect.poll(async () => (await getProjectAgent(entry.id)).running, { timeout: 20000 }).toBe(false);
        return (await getProjectAgent(entry.id)).messages;
      };
      await startProjectAgent(entry, { text: 'Check the requirement in requirements.md' });
      const prepared = await settled();
      expect(prepared.filter(m => m.kind === 'journey-plan')).toHaveLength(1);
      expect(prepared.some(m => m.kind === 'journey-result')).toBe(false);
      ui = await startConsole({ port: 0 });
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(ui.url);
      await page.getByRole('tab', { name: 'Repair chat' }).click();
      await page.getByText('Review actors, actions and assertions').click();
      await page.getByRole('button', { name: 'Run test scenario' }).click();
      await page.getByText('Logic check results', { exact: true }).waitFor();
      await page.getByText('Passed · B · B after confirmation', { exact: true }).waitFor();
      const result = (await settled()).find(m => m.kind === 'journey-result');
      expect(result?.data?.status).toBe('not-verified');
      const priorCount = (await getProjectAgent(entry.id)).messages.filter(m => m.kind === 'journey-plan').length;
      actions.push({ type: 'prepare_journey', basis: 'same-fact', definition }, { type: 'prepare_journey', search: quote, definition }, { type: 'answer', text: 'Prepared.' });
      await startProjectAgent(entry, { text: quote });
      const plans = (await settled()).filter(m => m.kind === 'journey-plan');
      expect(plans).toHaveLength(priorCount + 1);
      expect(plans.at(-1)?.data).toMatchObject({ quote });
      expect(plans.at(-1)?.data?.path).toBeUndefined();
      const sides = ['owner', 'A'].map(actor => ({
        name: actor, actor, route: '/session/' + actor,
        observe: [
          ...['object','field','version'].map(key => ({ id: actor + key, target: { css: 'output' }, read: 'attribute', attribute: 'data-' + key })),
          { id: actor + 'value', target: { css: 'output' }, read: 'text' },
        ],
      }));
      const rule = { name: 'Same displayed fact', left: 'ownervalue', op: 'eq', right: { ref: 'Avalue' }, sameFact: { object: ['ownerobject','Aobject'], field: ['ownerfield','Afield'], version: ['ownerversion','Aversion'] } };
      actions.push({ type: 'prepare_journey', basis: 'same-fact', definition: { name: 'Check consistency', requirement: 'Same fact', phases: [sides[0], { ...sides[1], assert: [rule] }] } }, { type: 'answer', text: 'Ready.' });
      await startProjectAgent(entry, { text: 'Check for a contradiction.' });
      const builtIn = (await settled()).filter(m => m.kind === 'journey-plan').at(-1);
      expect(builtIn?.data?.basis).toBe('same-fact');
      const res = await fetch(`http://127.0.0.1:${ui.port}/api/projects/${entry.id}/agent/journey`, { method: 'POST', headers: { 'x-uxqa-token': ui.token, 'content-type':'application/json' }, body: JSON.stringify({ planId: builtIn!.id }) });
      expect(res.status).toBe(202);
      expect((await settled()).filter(m => m.kind === 'journey-result').at(-1)?.data?.status).toBe('not-verified');
      expect(result?.privateData?.phases).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'B after confirmation', status: 'pass' }), expect.objectContaining({ status: 'not-verified' })]));
    } finally {
      await browser?.close(); await stopProjectAgents(); await ui?.close(); await close(site); await close(model);
      if (previous === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previous;
      await rm(home, { recursive: true, force: true }); await rm(root, { recursive: true, force: true });
    }
  }, 45_000);
});
