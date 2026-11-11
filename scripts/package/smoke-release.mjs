// Native-runtime smoke on each release runner. Fixtures only; no personal accounts.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TAR } from './targets.mjs';

const archive = resolve(process.argv[2]);
const work = await mkdtemp(join(tmpdir(), 'uxqa-release-smoke-'));
const home = join(work, 'private-home');
await mkdir(home);
let child;
const fixture = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'vision-fixture' }] }));
  else { res.statusCode = 404; res.end('{}'); }
});
try {
  const extract = spawnSync(TAR, ['-xf', archive, '-C', work], { encoding: 'utf8' });
  assert.equal(extract.status, 0, `Extract failed: ${extract.stderr}`);
  const top = (await readdir(work)).find((name) => name === 'UXQA.app' || name.startsWith('uxqa-'));
  assert.ok(top, 'Archive has an application folder');
  const native = top.endsWith('.app');
  const root = native ? join(work, top, 'Contents/Resources') : join(work, top);
  const exe = process.platform === 'win32' ? '.exe' : '';
  const node = join(root, `runtime/node${exe}`);
  const core = join(root, `model-core/uxqa-model-core${exe}`);
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LOCAL-DATA-AND-PERMISSIONS.md', 'model-core/LICENSE', 'model-core/THIRD-PARTY-NOTICES.txt', 'app/THIRD-PARTY-NOTICES.txt']) {
    assert.ok((await readFile(join(root, file))).length > 20, `Missing notice: ${file}`);
  }
  const metadata = await readFile(join(root, 'BUILD-INFO.json'), 'utf8');
  assert.ok(!/\/(Users|home)\/[^/]+\//.test(metadata), 'No private builder home paths in metadata');
  const env = { ...process.env, UXQA_HOME: home, UXQA_MODEL_CORE: core };
  delete env.UXQA_UI_TOKEN;
  const help = spawnSync(node, [join(root, 'app/uxqa.mjs'), '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0, `Bundled CLI failed: ${help.stderr}`);
  assert.match(help.stdout, /uxqa/);
  for (const [tool, argument] of [['jscpd/run-jscpd.js', '--version'], ['react-scanner/bin/react-scanner', '--help']]) {
    const checked = spawnSync(node, [join(root, 'app/node_modules', tool), argument], { env, encoding: 'utf8' });
    assert.equal(checked.status, 0, `Source tool ${tool} failed: ${checked.stderr}`);
  }
  child = spawn(node, [join(root, 'app/desktop.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const url = await new Promise((done, fail) => {
    let text = '';
    const timer = setTimeout(() => fail(new Error('Console startup timed out')), 30000);
    const finish = (error, value) => { clearTimeout(timer); error ? fail(error) : done(value); };
    child.once('error', (error) => finish(error));
    child.once('exit', (code) => finish(new Error(`Console exited ${code}`)));
    child.stdout.on('data', (chunk) => {
      text += chunk;
      if (text.includes('\n')) {
        try { finish(null, JSON.parse(text.split('\n')[0]).url); } catch (error) { finish(error); }
      }
    });
  });
  const origin = new URL(url).origin;
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('t');
  const api = async (path, body) => {
    const response = await fetch(`${origin}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-uxqa-token': token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    assert.ok(response.ok, `${path}: ${response.status} ${result.error ?? ''}`);
    return result;
  };
  assert.equal((await fetch(`${origin}/api/projects`)).status, 401);
  assert.equal((await fetch(`${origin}/icon.png`)).headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${origin}/workflow.js`)).status, 200);
  const quality = await api('/quality');
  assert.equal(quality.procedures.length, 27, 'Native quality procedures are bundled');
  assert.equal(quality.focuses.length, 10, 'Diagnosis goals are bundled');
  assert.equal(quality.scenarioChecks, 81, 'Scenario checks are bundled');
  assert.equal(quality.stackFamilies, 22, 'Stack guidance is bundled');
  const product = join(work, 'verification-fixture');
  await mkdir(join(product, 'src'), { recursive: true });
  await writeFile(join(product, 'package.json'), JSON.stringify({ name: 'verification-fixture' }));
  const fixtureSource = 'export default function Screen() { return <button>Save</button>; }';
  await writeFile(join(product, 'src/Screen.tsx'), fixtureSource);
  const project = (await api('/projects', { path: product, name: 'Isolated verification fixture' })).project;
  let job = (await api(`/projects/${project.id}/check`, { skipPages: true })).job;
  for (let attempt = 0; attempt < 100 && job.state === 'running'; attempt++) {
    await new Promise((done) => setTimeout(done, 100));
    job = (await api(`/projects/${project.id}/jobs/${job.id}`)).job;
  }
  assert.equal(job.state, 'done', 'Packaged source check produces a real round');
  const plan = (await api(`/projects/${project.id}/diagnosis`, { focus: 'motion', roundId: job.roundId })).plan;
  assert.ok(plan.tasks.length > 0, 'Packaged diagnostic plan contains tasks');
  const verificationPath = `/projects/${project.id}/diagnosis/${plan.id}/verification`;
  await api(verificationPath, { taskId: plan.tasks[0].id, status: 'failed', note: 'Synthetic smoke record: observation captured for fixture only.' });
  const verified = await api(verificationPath);
  assert.equal(verified.summary.failed, 1, 'Packaged verification evidence persists');
  assert.equal(verified.summary.passed, 0, 'Recording evidence does not automatically pass tasks');
  assert.equal(await readFile(join(product, 'src/Screen.tsx'), 'utf8'), fixtureSource, 'Verification leaves product source unchanged');
  assert.ok((await api('/ai/engine')).available, 'Bundled model core is available');
  const state = await api('/ai/native/state');
  assert.deepEqual(state.accounts, [], 'Fresh package never imports accounts');
  assert.deepEqual(state.providers, [], 'Fresh package has no private providers');
  if (!env.UXQA_GEMINI_OAUTH_CLIENT_ID || !env.UXQA_GEMINI_OAUTH_CLIENT_SECRET) {
    assert.equal(state.capabilities.find((item) => item.id === 'gemini').available, false);
    const login = await fetch(`${origin}/api/ai/native/login`, { method: 'POST', headers: { 'x-uxqa-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'gemini' }) });
    assert.equal(login.status, 400, 'Missing Google OAuth configuration is rejected before login');
    assert.match((await login.json()).error, /OAuth/);
  }
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const saved = await api('/ai/native/providers', { name: 'Release fixture', protocol: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture-not-a-secret' });
  assert.ok(saved.id);
  const after = await api('/ai/native/state');
  assert.ok(!JSON.stringify(after).includes('fixture-not-a-secret'), 'Provider keys are redacted');
  const models = await api('/ai/models', { connection: 'native' });
  assert.ok(JSON.stringify(models).includes('vision-fixture'), 'Models discovered through packaged core');
  await api('/ai/native/provider-delete', { id: saved.id });
  assert.equal((await api('/ai/native/state')).providers.length, 0);
  const exited = once(child, 'exit');
  child.stdin.end();
  const deadline = setTimeout(() => child.kill(), 12000);
  const [code] = await exited;
  clearTimeout(deadline);
  assert.equal(code, 0, 'Host shuts down cleanly when owner closes pipe');
  await assert.rejects(fetch(`${origin}/api/projects`), 'Console port closes on quit');
  console.log(`PASS ${process.platform}/${process.arch}: CLI, UI/icon, auth, isolated account store, provider CRUD, model discovery and shutdown`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 8000);
    await exited; clearTimeout(timer);
  }
  if (fixture.listening) await new Promise((done) => fixture.close(done));
  await rm(work, { recursive: true, force: true });
}
