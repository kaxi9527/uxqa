import { createServer, request as httpRequest, type Server } from 'node:http';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSETS } from '../src/ui/assets.js';
import { startConsole, type ConsoleServer } from '../src/ui/server.js';

const TOKEN = 'test-token-for-console-1234';
let home: string;
let product: string;
let consoleServer: ConsoleServer;
let site: Server;
let siteUrl: string;

async function call(path: string, options: { method?: string; body?: unknown; token?: string | null; host?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.token !== null) headers['x-uxqa-token'] = options.token ?? TOKEN;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.host) headers.host = options.host;
  const response = await fetch(`http://127.0.0.1:${consoleServer.port}${path}`, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const type = response.headers.get('content-type') ?? '';
  return { status: response.status, type, data: type.includes('json') ? await response.json() : await response.arrayBuffer() };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'uxqa-console-home-'));
  product = await mkdtemp(join(tmpdir(), 'uxqa-console-product-'));
  await cp(resolve('examples/check-fixture'), product, { recursive: true });
  process.env.UXQA_HOME = home;
  process.env.UXQA_UI_TOKEN = TOKEN;
  const html = await readFile(resolve('examples/check-fixture-site/index.html'), 'utf8');
  site = createServer((request, response) => {
    if (request.url !== '/') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  siteUrl = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  consoleServer = await startConsole({ port: 0 });
});

afterAll(async () => {
  await consoleServer.close();
  await new Promise<void>((done) => site.close(() => done()));
  delete process.env.UXQA_HOME;
  delete process.env.UXQA_UI_TOKEN;
  await rm(home, { recursive: true, force: true });
  await rm(product, { recursive: true, force: true });
});

describe('local console', () => {
  it('serves the embedded page and keeps the generated assets in sync with src/ui/web', async () => {
    for (const [route, file] of [['/index.html', 'index.html'], ['/app.css', 'app.css'], ['/app.js', 'app.js']]) {
      expect(ASSETS[route].body).toBe(await readFile(resolve('src/ui/web', file), 'utf8'));
    }
    const page = await fetch(`http://127.0.0.1:${consoleServer.port}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(consoleServer.url).toContain(`#t=${TOKEN}`);
  });

  it('only answers this machine with the start token', async () => {
    expect((await call('/api/projects', { token: null })).status).toBe(401);
    expect((await call('/api/projects', { token: 'wrong-token-wrong-token' })).status).toBe(401);
    // A page on another host name that resolves to 127.0.0.1 (DNS rebinding) is refused; fetch cannot set Host, so use http.request.
    const rebinding = await new Promise<number>((done, fail) => {
      const outgoing = httpRequest({ host: '127.0.0.1', port: consoleServer.port, path: '/api/projects', headers: { host: 'evil.example', 'x-uxqa-token': TOKEN } }, (incoming) => { incoming.resume(); done(incoming.statusCode ?? 0); });
      outgoing.on('error', fail);
      outgoing.end();
    });
    expect(rebinding).toBe(403);
    expect((await call('/api/projects')).status).toBe(200);
  });

  it('adds a project with plain errors for bad paths, and finds its library', async () => {
    const bad = await call('/api/projects', { method: 'POST', body: { path: join(product, 'missing') } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toContain('不是一个存在的文件夹');
    const added = await call('/api/projects', { method: 'POST', body: { path: join(product, 'src/pages') } });
    expect(added.status).toBe(200);
    expect(added.data.library).toMatchObject({ library: 'src/components/ui', source: 'shadcn' });
    expect((await call('/api/projects')).data.projects).toHaveLength(1);
  });

  it('validates page settings and tests the preview address', async () => {
    const id = (await call('/api/projects')).data.projects[0].id;
    // A bare host:port gets http:// added instead of being refused.
    expect((await call(`/api/projects/${id}/settings`, { method: 'POST', body: { baseUrl: 'localhost:3000' } })).data.pages.baseUrl).toBe('http://localhost:3000');
    expect((await call(`/api/projects/${id}/settings`, { method: 'POST', body: { baseUrl: 'ftp://example.com' } })).data.error).toContain('http');
    expect((await call(`/api/projects/${id}/settings`, { method: 'POST', body: { baseUrl: siteUrl, routes: 'orders' } })).data.error).toContain('以 / 开头');
    expect((await call(`/api/projects/${id}/settings/test`, { method: 'POST', body: { baseUrl: siteUrl, routes: '/' } })).data).toMatchObject({ ok: true });
    expect((await call(`/api/projects/${id}/settings/test`, { method: 'POST', body: { baseUrl: 'http://127.0.0.1:1', routes: '/' } })).data.ok).toBe(false);
    const saved = await call(`/api/projects/${id}/settings`, { method: 'POST', body: { baseUrl: siteUrl, routes: '/', discover: false } });
    expect(saved.data.pages).toMatchObject({ baseUrl: siteUrl, routes: ['/'], discover: false });
  });

  it('runs a check in the background, pairs problems with screenshots, and compares rounds', async () => {
    const id = (await call('/api/projects')).data.projects[0].id;
    const start = await call(`/api/projects/${id}/check`, { method: 'POST' });
    expect(start.status).toBe(202);
    expect((await call(`/api/projects/${id}/check`, { method: 'POST' })).status).toBe(409);
    let job = start.data.job;
    for (let attempt = 0; attempt < 200 && job.state === 'running'; attempt++) {
      await new Promise((done) => setTimeout(done, 150));
      job = (await call(`/api/projects/${id}/jobs/${job.id}`)).data.job;
    }
    expect(job.state).toBe('done');
    const { round, prompt } = (await call(`/api/projects/${id}/rounds/${job.roundId}`)).data;
    expect(round.number).toBe(1);
    expect(prompt).toContain('src/pages/Orders.tsx:7');
    const tab = round.result.violations.find((violation: { file: string; line: number }) => violation.file === 'src/pages/Orders.tsx' && violation.line === 7);
    const capture = round.capture.captures[tab.fingerprint];
    expect(capture).toMatchObject({ status: 'found', matches: 1 });
    expect(capture.shots[0].crop).toMatch(/^issue-\d+-.*\.png$/);
    const duplicate = round.result.violations.find((violation: { title: string }) => violation.title === '重复了');
    expect(round.capture.captures[duplicate.fingerprint].status).toBe('not-locatable');
    expect(round.screenshots).toBeGreaterThanOrEqual(6);

    const image = await fetch(`http://127.0.0.1:${consoleServer.port}/api/projects/${id}/shot?round=${round.id}&name=${capture.shots[0].crop}&t=${TOKEN}`);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(500);
    expect((await fetch(`http://127.0.0.1:${consoleServer.port}/api/projects/${id}/shot?round=${round.id}&name=../projects.json&t=${TOKEN}`)).status).toBe(400);

    const second = (await call(`/api/projects/${id}/check`, { method: 'POST' })).data.job;
    let next = second;
    for (let attempt = 0; attempt < 200 && next.state === 'running'; attempt++) {
      await new Promise((done) => setTimeout(done, 150));
      next = (await call(`/api/projects/${id}/jobs/${second.id}`)).data.job;
    }
    const rounds = (await call(`/api/projects/${id}/rounds`)).data.rounds;
    expect(rounds.map((entry: { number: number }) => entry.number)).toEqual([2, 1]);
    expect(rounds[0]).toMatchObject({ appeared: 0, resolved: 0 });
  }, 120_000);

  it('opens a browser for logging in and saves the login state privately on request', async () => {
    process.env.UXQA_LOGIN_HEADLESS = '1';
    const id = (await call('/api/projects')).data.projects[0].id;
    expect((await call(`/api/projects/${id}/login/finish`, { method: 'POST' })).status).toBe(400);
    expect((await call(`/api/projects/${id}/login/start`, { method: 'POST' })).data.started).toBe(true);
    const finished = await call(`/api/projects/${id}/login/finish`, { method: 'POST' });
    expect(finished.data.saved).toBe(join(home, 'auth', `${id}.json`));
    expect((await stat(finished.data.saved)).mode & 0o777).toBe(0o600);
    expect(finished.data.pages.storageState).toBe(finished.data.saved);
    delete process.env.UXQA_LOGIN_HEADLESS;
  }, 60_000);

  it('shows code only from inside the project', async () => {
    const id = (await call('/api/projects')).data.projects[0].id;
    const excerpt = await call(`/api/projects/${id}/excerpt?file=src/pages/Orders.tsx&line=7`);
    expect(excerpt.data.start).toBe(2);
    expect(excerpt.data.lines[5]).toContain('role="tab"');
    expect((await call(`/api/projects/${id}/excerpt?file=../../../etc/hosts&line=1`)).status).toBeGreaterThanOrEqual(403);
  });

  it('explains rule mistakes plainly and writes rules only after confirmation', async () => {
    const id = (await call('/api/projects')).data.projects[0].id;
    const broken = await call(`/api/projects/${id}/rules/preview`, { method: 'POST', body: { raw: '{"rules": [ {"id": "x" "type": 1} ]}' } });
    expect(broken.data.error).toMatch(/第 1 行第 \d+ 个字附近/);
    const reasonless = await call(`/api/projects/${id}/rules/preview`, { method: 'POST', body: { raw: '{"rules":[{"id":"basic/no-arbitrary-size","level":"off"}]}' } });
    expect(reasonless.data.error).toContain('reason');
    const raw = JSON.stringify({ rules: [{ id: 'basic/no-arbitrary-size', level: 'off', reason: '示例项目不检查尺寸' }] });
    expect((await call(`/api/projects/${id}/rules/save`, { method: 'POST', body: { raw } })).status).toBe(400);
    await expect(stat(join(product, '.uxqa/rules.json'))).rejects.toThrow();
    const saved = await call(`/api/projects/${id}/rules/save`, { method: 'POST', body: { raw, confirm: true } });
    expect(saved.data.rules.disabled).toEqual([{ id: 'basic/no-arbitrary-size', reason: '示例项目不检查尺寸' }]);
    expect(JSON.parse(await readFile(join(product, '.uxqa/rules.json'), 'utf8')).rules[0].reason).toBe('示例项目不检查尺寸');
  });

  it('groups library parts per file and flags the duplicate copy', async () => {
    const id = (await call('/api/projects')).data.projects[0].id;
    const { components } = (await call(`/api/projects/${id}/components`)).data;
    expect(components.find((component: { name: string }) => component.name === 'Tabs')).toMatchObject({ parts: ['TabsList', 'TabsTrigger', 'TabsContent'] });
    expect(components.find((component: { file: string }) => component.file.endsWith('legacy.tsx')).duplicateOf).toBe('src/components/ui/button.tsx');
    expect((await call(`/api/projects/${id}/components?q=${encodeURIComponent('日历')}`)).data.components).toEqual([]);
  });
});
