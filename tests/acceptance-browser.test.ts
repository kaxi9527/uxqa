import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { summarizeRun } from '../src/report.js';
import { writeReports } from '../src/report-writer.js';
import { runAudit } from '../src/runner.js';

const exec = promisify(execFile);

const GOOD = `<!doctype html><html lang="en"><head><title>Items</title><style>button:focus-visible{outline:3px solid #005fcc}</style></head><body><main>
<h1>Items</h1><div id="list">Loading</div><div role="status" id="status"></div><button id="retry" hidden>Retry</button>
<form id="form"><label>Name <input id="name"></label><button id="save" type="submit">Save</button></form>
<script>
async function load(){const list=document.getElementById('list');const status=document.getElementById('status');const retry=document.getElementById('retry');
try{const response=await fetch('/api/items');if(!response.ok)throw new Error('bad');const items=await response.json();list.textContent=items.length?items.join(', '):'No items yet';status.textContent='';retry.hidden=true;}
catch(error){list.textContent='';status.textContent='Could not load items';retry.hidden=false;}}
document.getElementById('retry').onclick=load;
document.getElementById('form').onsubmit=async(event)=>{event.preventDefault();const button=document.getElementById('save');if(button.disabled)return;button.disabled=true;
await fetch('/api/save',{method:'POST',body:document.getElementById('name').value});button.disabled=false;document.getElementById('status').textContent='Saved';};
load();
</script></main></body></html>`;

const BAD = `<!doctype html><html lang="en"><head><title>Bad</title><style>button{outline:none}.wide{width:900px}@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin 1s linear infinite;width:20px}</style></head>
<body><main><h1>Bad</h1><button>Plain</button><div role="button">Fake control</div><div class="wide">Wide content row</div><div class="spin">o</div></main></body></html>`;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/api/items') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(['alpha', 'beta'])); return; }
    if (request.url === '/api/save') { response.statusCode = 204; response.end(); return; }
    response.setHeader('content-type', 'text/html');
    response.end(request.url === '/bad' ? BAD : GOOD);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe('acceptance evidence for states, keyboard and reflow', () => {
  it('exercises empty, failure, retry and duplicate-submit states with injected network and records Q-03 results', async () => {
    const output = await mkdtemp(join(tmpdir(), 'uxqa-states-'));
    try {
      const config = loadConfig({
        name: 'states', baseUrl, routes: ['/'],
        viewports: [{ name: 'desktop', width: 1000, height: 700 }],
        evidence: { dataNature: 'fixture', environment: 'local fixture' },
        notApplicable: [{ check: 'real-device', reason: 'Fixture page has no device-specific behaviour' }],
        options: { trace: 'off' },
        flows: [
          { name: 'empty list', requirement: 'REQ-001', network: [{ match: '**/api/items', respond: { status: 200, json: [] } }],
            steps: [{ action: 'expectText', target: { css: '#list' }, text: 'No items yet', exact: true }] },
          { name: 'load failure then retry', requirement: 'REQ-002', expected: 'Failure is announced and retry recovers',
            network: [{ match: '**/api/items', times: 1, respond: { status: 500, json: { error: 'down' } } }],
            steps: [
              { action: 'expectAnnounced', text: 'Could not load items' },
              { action: 'click', target: { role: 'button', name: 'Retry' } },
              { action: 'expectText', target: { css: '#list' }, text: 'alpha' },
              { action: 'expectHidden', target: { role: 'button', name: 'Retry' } },
            ] },
          { name: 'no duplicate submit', requirement: 'REQ-003', network: [{ match: '/api/save', method: 'POST', delayMs: 600 }],
            steps: [
              { action: 'fill', target: { label: 'Name' }, value: 'Ada' },
              { action: 'press', target: { label: 'Name' }, key: 'Enter' },
              { action: 'expectDisabled', target: { role: 'button', name: 'Save' } },
              { action: 'press', target: { label: 'Name' }, key: 'Enter' },
              { action: 'expectRequestCount', match: '/api/save', method: 'POST', count: 1 },
              { action: 'expectAnnounced', text: 'Saved' },
              { action: 'expectEnabled', target: { role: 'button', name: 'Save' } },
              { action: 'expectValue', target: { label: 'Name' }, value: 'Ada' },
            ] },
          { name: 'offline load', offline: true,
            steps: [{ action: 'click', target: { role: 'button', name: 'Save' } }, { action: 'expectAnnounced', text: 'Saved' }] },
        ],
      });
      const result = await runAudit(config, { outDir: output });
      const status = (check: string, flow?: string) => result.checks.find((entry) => entry.check === check && entry.flow === flow)?.status;
      expect(status('flow', 'empty list')).toBe('pass');
      expect(status('flow', 'load failure then retry')).toBe('pass');
      expect(status('flow', 'no duplicate submit')).toBe('pass');
      // The fixture does not handle offline submission, so the flow fails with a located reason.
      expect(status('flow', 'offline load')).toBe('fail');
      expect(result.checks.find((entry) => entry.flow === 'load failure then retry')).toMatchObject({ requirement: 'REQ-002', dataNature: 'mock' });
      expect(result.checks.find((entry) => entry.flow === 'no duplicate submit')?.dataNature).toBe('fixture');
      expect(status('page-load')).toBe('pass');
      expect(status('axe')).toBe('pass');
      expect(status('keyboard-focus')).toBe('pass');
      expect(status('reflow-320')).toBe('pass');
      expect(status('zoom-200')).toBe('pass');
      expect(status('reduced-motion')).toBe('pass');
      expect(status('real-device')).toBe('not-applicable');
      expect(status('real-api')).toBe('not-verified');
      expect(status('screen-reader')).toBe('not-verified');
      // Injected 500s and aborted offline requests are informational, not blocking console/network defects.
      expect(status('console')).toBe('pass');
      expect(status('network')).toBe('pass');
      const blocking = result.findings.filter((finding) => finding.severity === 'blocking');
      expect(blocking.map((finding) => finding.kind)).toEqual(['flow']);
      expect(blocking[0]).toMatchObject({ step: expect.stringContaining('offline load step 2') });
      expect(summarizeRun(result).verdict).toBe('fail');

      const { markdownPath } = await writeReports(result, output);
      const markdown = await readFile(markdownPath, 'utf8');
      expect(markdown).toContain('结论（Q-03）：**失败**');
      expect(markdown).toContain('## 需求追踪');
      expect(markdown).toContain('- REQ-002: 通过 1');
      expect(markdown).toContain('测试数据性质：fixture');
      expect(markdown).toContain('| **不适用** | Fixture page has no device-specific behaviour |');
      expect(markdown).toContain('not real integration');
    } finally { await rm(output, { recursive: true, force: true }); }
  }, 120_000);

  it('fails keyboard focus and reflow on a page without focus styles or reflow, and records the product revision', async () => {
    const output = await mkdtemp(join(tmpdir(), 'uxqa-bad-'));
    const product = await mkdtemp(join(tmpdir(), 'uxqa-product-'));
    try {
      await exec('git', ['init', '-q', product]);
      await writeFile(join(product, 'index.html'), BAD);
      await exec('git', ['-C', product, 'add', '.']);
      await exec('git', ['-C', product, '-c', 'user.email=qa@example.invalid', '-c', 'user.name=qa', 'commit', '-qm', 'fixture']);
      await writeFile(join(product, 'wip.txt'), 'uncommitted');
      const config = loadConfig({
        name: 'bad', baseUrl: `${baseUrl}/bad`, viewports: [{ name: 'desktop', width: 1000, height: 700 }],
        evidence: { productRoot: product, dataNature: 'real' }, options: { axe: false, trace: 'off', screenshots: false },
      });
      const result = await runAudit(config, { outDir: output });
      const keyboard = result.checks.find((entry) => entry.check === 'keyboard-focus');
      expect(keyboard?.status).toBe('fail');
      expect(keyboard?.detail).toMatch(/without a detectable focus style change/);
      expect(keyboard?.detail).toMatch(/no tabindex/);
      expect(result.checks.find((entry) => entry.check === 'reflow-320')?.status).toBe('fail');
      expect(result.checks.find((entry) => entry.check === 'zoom-200')?.status).toBe('fail');
      expect(result.checks.find((entry) => entry.check === 'reduced-motion')?.status).toBe('not-verified');
      expect(result.checks.find((entry) => entry.check === 'axe')?.status).toBe('not-verified');
      expect(result.findings.find((finding) => finding.kind === 'reflow' && finding.severity === 'blocking')?.evidence?.join(' ')).toContain('div.wide');
      expect(result.findings.some((finding) => finding.kind === 'motion' && finding.severity === 'info')).toBe(true);
      expect(result.checks.some((entry) => entry.check === 'real-api')).toBe(false);
      expect(result.evidence?.product.git).toMatchObject({ dirty: true, changedFiles: 1, revision: expect.stringMatching(/^[0-9a-f]{40}$/) });
      expect(result.checks.find((entry) => entry.check === 'code-revision')).toMatchObject({ status: 'pass', detail: expect.stringContaining('1 uncommitted change') });
      const stops = JSON.parse(await readFile(result.artifacts.find((entry) => entry.includes('keyboard-'))!, 'utf8'));
      expect(stops.stops.map((stop: { name: string }) => stop.name)).toEqual(['Plain']);
    } finally {
      await rm(output, { recursive: true, force: true });
      await rm(product, { recursive: true, force: true });
    }
  }, 120_000);
});
