// Exercises the actual UXQA app bundle and source-built module with a local fixture.
// No real credentials, paid inference, external management app or account import.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const app = resolve(process.argv[2]);
const evidence = resolve(process.argv[3]);
await mkdir(evidence, { recursive: true });
const home = await mkdtemp(join(tmpdir(), 'uxqa-desktop-smoke-'));
const resources = join(app, 'Contents/Resources');
let browser, child, page;
let ownedChildren = [];
const requests = [];
const fixture = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  requests.push({ path: req.url, image: JSON.stringify(body).includes('image') || JSON.stringify(body).includes('inlineData'), stream: body.stream ?? false });
  if (body.stream || req.url.includes(':streamGenerateContent')) {
    res.setHeader('content-type', 'text/event-stream');
    const event = (type, data) => res.write(`${type ? `event: ${type}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
    if (req.url.endsWith('/responses')) {
      event('response.created', { type: 'response.created', response: { id: 'fixture', model: 'vision-fixture', status: 'in_progress', output: [] } });
      event('response.output_text.delta', { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '绿色' });
      event('response.completed', { type: 'response.completed', response: { id: 'fixture', status: 'completed', model: 'vision-fixture', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '绿色' }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    } else if (req.url.endsWith('/messages')) {
      event('message_start', { type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: 'vision-fixture', content: [], usage: { input_tokens: 1, output_tokens: 0 } } });
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '绿色' } });
      event('content_block_stop', { type: 'content_block_stop', index: 0 });
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } });
      event('message_stop', { type: 'message_stop' });
    } else if (req.url.includes(':streamGenerateContent')) {
      event('', { candidates: [{ content: { role: 'model', parts: [{ text: '绿色' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
    } else {
      event('', { id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: '绿色' }, finish_reason: null }] });
      event('', { id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n');
    }
    res.end(); return;
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(req.method === 'GET' ? { data: [{ id: 'vision-fixture' }] } : req.url.endsWith('/responses') ? { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '绿色' }] }] } : req.url.endsWith('/messages') ? { id: 'fixture-message', type: 'message', role: 'assistant', content: [{ type: 'text', text: '绿色' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } : req.url.includes(':generateContent') ? { candidates: [{ content: { role: 'model', parts: [{ text: '绿色' }] }, finishReason: 'STOP' }] } : { id: 'fixture-response', object: 'chat.completion', model: 'vision-fixture', choices: [{ index: 0, message: { role: 'assistant', content: '绿色' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
});
const assert = (ok, message) => { if (!ok) throw new Error(message); };
try {
  await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${fixture.address().port}/v1`;
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(resources, { recursive: true });
  assert(!entries.some((p) => /(^|\/)magpie(\.|$|\/)/i.test(p)), 'Bundle contains a Magpie executable or management app');
  child = spawn(join(resources, 'runtime/node'), [join(resources, 'app/desktop.mjs')], { env: { ...process.env, UXQA_HOME: home, UXQA_UI_TOKEN: 'uxqa-local-fixture-not-a-secret', UXQA_MODEL_CORE: join(resources, 'model-core/uxqa-model-core') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const url = await new Promise((done, fail) => {
    let text = '';
    const timer = setTimeout(() => fail(new Error('Desktop backend startup timeout')), 15000);
    child.once('error', fail);
    child.stdout.on('data', (chunk) => { text += chunk; if (text.includes('\n')) { clearTimeout(timer); done(JSON.parse(text.split('\n')[0]).url); } });
  });
  const origin = new URL(url).origin;
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('t');
  const api = async (path, input) => {
    const reply = await fetch(`${origin}/api${path}`, { method: input ? 'POST' : 'GET', headers: { 'x-uxqa-token': token, 'content-type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) });
    const data = await reply.json();
    assert(reply.ok, data.error ?? `${path}: ${reply.status}`);
    return data;
  };
  assert((await fetch(`${origin}/api/ai/engine`)).status === 401, 'Engine endpoint must require the console token');
  assert((await api('/ai')).mcp.args[0] === join(resources, 'app/uxqa.mjs'), 'Desktop MCP command must use the CLI, not the window host');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '直接连接 API', exact: true }).click();
  await page.getByLabel('接口类型', { exact: true }).selectOption('responses');
  await page.getByLabel('模型地址', { exact: true }).fill(base);
  await page.getByLabel('API Key', { exact: true }).fill('fixture-not-a-secret');
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await page.getByRole('option', { name: 'vision-fixture', exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('combobox', { name: '可用模型', exact: true }).selectOption('vision-fixture');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('连接成功，模型看图回答：绿色', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存。下一轮检测完会自动让 AI 看截图；已有的检测也可以在问题列表上方点"AI 看图复核"。', { exact: true }).waitFor();
  assert((await api('/ai')).settings.protocol === 'responses', 'Protocol selection must persist');
  await page.screenshot({ path: join(evidence, 'direct-api.png'), fullPage: true });
  // A blank key on a different endpoint must never reuse the previous endpoint's secret.
  await api('/ai', { mode: 'api', connection: 'direct', protocol: 'responses', baseUrl: `${base}/other`, model: 'vision-fixture', apiKey: '' });
  assert(!(await api('/ai')).settings.hasKey, 'Changing an endpoint must clear its old key');
  await page.getByRole('button', { name: '模型与账号', exact: true }).click();
  await page.getByText('还没有在 UXQA 登录的订阅账号。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '添加服务商', exact: true }).click();
  await page.getByLabel('服务商名称', { exact: true }).fill('UXQA local fixture');
  await page.getByLabel('接口协议', { exact: true }).selectOption('openai');
  await page.getByLabel('模型地址', { exact: true }).fill(base);
  await page.getByLabel('API Key', { exact: true }).fill('fixture-not-a-secret');
  // Leave custom models empty: discovery must query the real fixture endpoint.
  await page.getByRole('button', { name: '保存服务商', exact: true }).click();
  await page.getByText('服务商已保存。现在可以获取模型。', { exact: true }).waitFor();
  const state = await api('/ai/native/state');
  assert(!JSON.stringify(state).includes('fixture-not-a-secret'), 'Provider state must redact API keys');
  assert(state.accounts.length === 0, 'Must not import external accounts');
  const modelID = `${state.providers[0].id}/vision-fixture`;
  await page.route('**/api/ai/models', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ models: [], warnings: [] }) }), { times: 1 });
  await page.getByRole('button', { name: '获取模型', exact: true }).click();
  await page.getByText('账号或服务商已添加，但暂未获取到模型。请检查连接后重试。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '获取模型', exact: true }).click();
  const listed = await api('/ai/models', { mode: 'api', connection: 'native' });
  assert(listed.models.includes(modelID), `Fixture model missing: ${JSON.stringify(listed)}`);
  await page.getByRole('option', { name: modelID, exact: true }).waitFor({ state: 'attached', timeout: 30000 });
  await page.getByRole('combobox', { name: '可用模型', exact: true }).selectOption(modelID);
  await page.getByRole('button', { name: '测试看图连接', exact: true }).click();
  await page.getByText('连接成功，模型看图回答：绿色', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存并用于复核', exact: true }).click();
  await page.getByText('已保存。下一轮检测完会自动让 AI 看截图；已有的检测也可以在问题列表上方点"AI 看图复核"。', { exact: true }).waitFor();
  assert((await api('/ai')).settings.connection === 'native', 'Native model selection must persist');
  await page.getByRole('button', { name: '登录订阅账号', exact: true }).click();
  const link = page.getByRole('link', { name: '在浏览器继续授权', exact: true });
  await link.waitFor();
  assert(new URL(await link.getAttribute('href')).hostname === 'auth.openai.com', 'Only vendor authorization opens externally');
  await page.getByRole('button', { name: '取消登录', exact: true }).click();
  await page.getByText('登录已取消。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert(await page.getByLabel('API Key', { exact: true }).inputValue() === '', 'Editing must never reveal saved key');
  await page.getByRole('button', { name: '保存服务商', exact: true }).click();
  await page.getByText('服务商已保存。现在可以获取模型。', { exact: true }).waitFor();
  assert((await api('/ai/native/state')).providers[0].hasKey, 'Editing without a key must preserve it');
  await page.screenshot({ path: join(evidence, 'native-model-settings.png'), fullPage: true });
  assert(await page.getByText(/Magpie|进入连接中心|打开连接中心/).count() === 0, 'UI must not present another product manager');
  for (const protocol of ['responses', 'anthropic', 'gemini']) {
    const p = await api('/ai/native/providers', { name: `fixture-${protocol}`, protocol, baseUrl: base, apiKey: 'fixture-only', models: ['vision-fixture'] });
    const result = await api('/ai/test', { connection: 'native', model: `${p.id}/vision-fixture` });
    assert(result.ok && result.message.includes('绿色'), `Native ${protocol} image forwarding failed: ${result.message}`);
    await api('/ai/native/provider-delete', { id: p.id });
  }
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert((await api('/ai/native/state')).providers.length === 1, 'Cancel must preserve provider');
  const status = await api('/ai/engine');
  ownedChildren = execFileSync('ps', ['-axo', 'pid,ppid'], { encoding: 'utf8' }).trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number)).filter(([, ppid]) => ppid === child.pid).map(([pid]) => pid);
  assert(status.running && state.accounts.length === 0, 'Native module must run with only UXQA accounts');
  const processes = execFileSync('ps', ['-axo', 'pid,ppid,comm'], { encoding: 'utf8' }).split('\n').filter((line) => ownedChildren.includes(Number(line.trim().split(/\s+/)[0])));
  assert(processes.length === 1 && processes[0].includes('uxqa-model-core') && !processes[0].toLowerCase().includes('magpie'), 'Only UXQA model module may be started');
  assert(requests.some((r) => r.path.endsWith('/responses') && r.image), 'Direct Responses must send the image');
  assert(requests.some((r) => r.path.endsWith('/chat/completions') && r.image), 'Native source module must forward the image to the fixture');
  assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  await page.setViewportSize({ width: 680, height: 800 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Settings overflow the window');
  await browser.close(); browser = undefined;
  const route = `/?settings=1#t=${token}`;
  const scenario = { name: 'UXQA desktop model settings', baseUrl: origin, routes: [route],
    viewports: [{ name: 'desktop', width: 1280, height: 900 }, { name: 'compact-window', width: 680, height: 800 }],
    options: { axe: true, screenshots: true, trace: 'on-failure' },
    flows: [{ name: 'model connection choices', requirement: 'DESKTOP-MODELS-UI', route, steps: [
      { action: 'click', target: { role: 'button', name: '直接连接 API', exact: true } },
      { action: 'selectOption', target: { label: '接口类型', exact: true }, value: 'gemini' },
      { action: 'expectValue', target: { label: '接口类型', exact: true }, value: 'gemini' },
      { action: 'click', target: { role: 'button', name: '模型与账号', exact: true } },
      { action: 'expectVisible', target: { role: 'button', name: '登录订阅账号', exact: true } },
    ] }] };
  // Ephemeral console token stays in the temporary fixture directory, never in retained evidence.
  const scenarioFile = join(home, 'scenario.json');
  await writeFile(scenarioFile, JSON.stringify(scenario));
  const qa = spawn(join(resources, 'runtime/node'), [join(resources, 'app/uxqa.mjs'), 'run', '--config', scenarioFile, '--out', join(evidence, 'uxqa')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let qaLog = '';
  for (const stream of [qa.stdout, qa.stderr]) stream.on('data', (part) => { qaLog += part; });
  const qaCode = await new Promise((done, fail) => { qa.once('error', fail); qa.once('exit', done); });
  await writeFile(join(evidence, 'uxqa.log'), qaLog.replaceAll(token, '[ephemeral-token]'));
  // UXQA persists routes for reproducibility: redact only this fixture's now-expiring console token.
  async function redact(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await redact(path);
      else if (/\.(json|html|md|txt)$/.test(entry.name)) await writeFile(path, (await readFile(path, 'utf8')).replaceAll(token, '[ephemeral-token]'));
    }
  }
  await redact(join(evidence, 'uxqa'));
  assert(qaCode === 0, 'UXQA browser audit has findings; inspect its report');
  await writeFile(join(evidence, 'smoke.json'), JSON.stringify({ ok: true, protocol: 'responses', sourceIntegratedRouting: true, nativeAccountUI: true, loginCancel: true, externalAccountDiscovery: false, browserErrors: errors, fixtureRequests: requests, realProviders: 'not verified; requires user authorization' }, null, 2));
  console.log('PASS: UXQA bundle, direct Responses, migrated protocol routing, native provider/login UI, credential isolation, window width');
} catch (error) {
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ message: error.message, fixtureRequests: requests }, null, 2));
  if (page) { await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {}); }
  throw error;
} finally {
  await browser?.close();
  if (child && child.exitCode === null) {
    const done = new Promise((resolve) => child.once('exit', resolve));
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
    await done; clearTimeout(timer);
  }
  let cleanupError;
  for (const pid of ownedChildren) {
    let alive = false; try { process.kill(pid, 0); alive = true; } catch {}
    if (alive) { process.kill(pid, 'SIGTERM'); cleanupError = new Error('A bundled engine child survived application shutdown'); }
  }
  await new Promise((resolve) => fixture.close(resolve));
  await rm(home, { recursive: true, force: true });
  if (cleanupError) throw cleanupError;
}
