import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { parseJourney } from '../src/config.js';
import { runBusinessJourney } from '../src/business-journey.js';
import { evaluateRelation } from '../src/journey-logic.js';

const input = new URL('../examples/logic/', import.meta.url);
const scenario = JSON.parse(await readFile(new URL('scenario.json', input), 'utf8')).journeys[0];

it('checks the observed starting value and catches undo restoring a different value', async () => {
  const html = await readFile(new URL('index.html', input), 'utf8');
  let broken = false;
  const site = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    const page = html.replace("'13'", "'87'");
    res.end(broken ? page.replace("state.setItem('value', state.getItem('previous'))", "state.setItem('value', '13')") : page);
  });
  await new Promise<void>(done => site.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + (site.address() as { port: number }).port;
  try {
    const browser = await chromium.launch();
    try {
      const plan = parseJourney(scenario);
      const good = await runBusinessJourney(browser, base, plan);
      expect(good.map(p => p.status)).toEqual(['pass', 'pass', 'pass']);
      expect(good[0].observations).toEqual({ before: { value: 87 } });
      broken = true;
      const bad = await runBusinessJourney(browser, base, plan);
      expect(bad[2].relations?.[0]).toMatchObject({ status: 'fail', detail: expect.stringContaining('before (87)') });
    } finally { await browser.close(); }
  } finally { await new Promise<void>(done => site.close(() => done())); }
});

it('compares a control to another view and distinguishes contradictions, absent conditions and missing observations', async () => {
  const responses: Record<string, string> = { '/editor': '<input aria-label="Title" value="Draft K">', '/summary': '<h1>Draft K</h1>' };
  const site = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(responses[req.url!]); });
  await new Promise<void>(done => site.listen(0, '127.0.0.1', done));
  try {
    const browser = await chromium.launch();
    try {
      const plan = parseJourney({ name: 'Linked views', requirement: 'Both views show the current title', phases: [
        { name: 'Edit view', actor: 'author', route: '/editor', observe: [{ id: 'title', target: { label: 'Title' }, read: 'value' }] },
        { name: 'Read view', actor: 'reader', route: '/summary', observe: [
          { id: 'heading', target: { role: 'heading' }, read: 'text' }, { id: 'revision', target: { role: 'heading' }, read: 'attribute', attribute: 'data-revision' },
        ], assert: [
          { name: 'Same title', left: 'heading', op: 'eq', right: { ref: 'title' } },
          { name: 'Conditional check', when: { left: 'heading', op: 'eq', right: { value: 'Final' } }, left: 'heading', op: 'ne', right: { ref: 'title' } },
          { name: 'Revision present', left: 'revision', op: 'eq', right: { value: '1' } },
        ] },
      ] });
      const base = 'http://127.0.0.1:' + (site.address() as { port: number }).port;
      const run = await runBusinessJourney(browser, base, plan);
      expect(run[1].status).toBe('not-verified');
      expect(run[1].relations?.map(r => r.status)).toEqual(['pass', 'not-verified', 'not-verified']);
      responses['/summary'] = '<h1>Final</h1>';
      const changed = await runBusinessJourney(browser, base, plan);
      expect(changed[1].status).toBe('fail');
      expect(changed[1].relations?.map(r => r.status)).toEqual(['fail', 'pass', 'not-verified']);
    } finally { await browser.close(); }
  } finally { await new Promise<void>(done => site.close(() => done())); }
});

it('checks inclusive numeric bounds, rejects ambiguous references and never orders text as numbers', () => {
  const facts = new Map([['value', { value: 9 }]]);
  for (const [op, status] of [['gt','fail'], ['gte','pass'], ['lt','fail'], ['lte','pass']] as const) {
    expect(evaluateRelation({ name: 'Boundary', left: 'value', op, right: { value: 9 } }, facts).status).toBe(status);
  }
  expect(evaluateRelation({ name: 'Size', left: 'text', op: 'lt', right: { value: '10' } }, new Map([['text', { value: '2' }]])).status).toBe('not-verified');
  expect(() => parseJourney({ ...scenario, phases: [...scenario.phases, scenario.phases[0]] })).toThrow('unique');
  expect(() => parseJourney({ ...scenario, phases: [scenario.phases[2]] })).toThrow('Unknown observation');
});

it('only calls conflicting displays a contradiction when their observed object, field and version match', async () => {
  let config = { object: 'doc/42', field: 'height:px', version: 'v2', value: '840' };
  const site = createServer((req, res) => {
    const data = req.url === '/first' ? { object: 'doc/42', field: 'height:px', version: 'v2', value: '820' } : config;
    res.setHeader('content-type', 'text/html');
    res.end('<output ' + Object.entries(data).map(([k,v]) => 'data-' + k + '="' + v + '"').join(' ') + '></output>');
  });
  await new Promise<void>(done => site.listen(0, '127.0.0.1', done));
  const phases = ['first', 'second'].map(view => ({
    name: view, actor: 'reader', route: '/' + view,
    observe: ['object','field','version','value'].map(key => ({ id: view + key, target: { css: 'output' }, read: 'attribute', attribute: 'data-' + key })),
  }));
  const rule = { name: 'Same fact', left: 'firstvalue', op: 'eq', right: { ref: 'secondvalue' }, sameFact: { object: ['firstobject','secondobject'], field: ['firstfield','secondfield'], version: ['firstversion','secondversion'] } };
  const plan = parseJourney({ name: 'Display consistency', requirement: 'Same fact at the same version', phases: [phases[0], { ...phases[1], assert: [rule] }] });
  try {
    const browser = await chromium.launch();
    try {
      const base = 'http://127.0.0.1:' + (site.address() as { port: number }).port;
      for (const [update, expected] of [
        [{}, 'fail'], [{version: 'v3'}, 'not-verified'], [{version: 'v2', field: 'height:mm'}, 'not-verified'],
        [{field: 'height:px', object: ''}, 'not-verified'], [{object:'doc/42', value:'820'}, 'pass'],
      ] as const) {
        config = { ...config, ...update };
        const result = await runBusinessJourney(browser, base, plan);
        expect(result[1].relations?.[0].status).toBe(expected);
      }
    } finally { await browser.close(); }
  } finally { await new Promise<void>(done => site.close(() => done())); }
});
