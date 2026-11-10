// Unpacks a download package into an empty folder and checks it works on this machine:
// `uxqa check` gives the same result as the source build, `uxqa ui` serves the console (and, with --no-browser,
// asks before downloading the browser and still finishes a source-only round), `uxqa mcp` lists its tools,
// and the double-click launcher starts the console.
//   node scripts/package/smoke.mjs release/uxqa-<version>-<target>.zip [--no-browser]
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROOT } from './targets.mjs';

const argv = process.argv.slice(2);
const archive = argv.find((value) => !value.startsWith('--'));
if (!archive) { console.error('用法：node scripts/package/smoke.mjs <包文件> [--no-browser] [--keep]'); process.exit(2); }
const noBrowser = argv.includes('--no-browser');
const fixture = join(ROOT, 'examples/check-fixture');
const results = [];
const ok = (name, detail = '') => { results.push({ name, ok: true }); console.log(`✓ ${name}${detail ? `  ${detail}` : ''}`); };
const bad = (name, detail) => { results.push({ name, ok: false }); console.log(`✗ ${name}  ${detail}`); };

const work = await mkdtemp(join(tmpdir(), 'uxqa-smoke-'));
const home = join(work, 'home');
await mkdir(home);
if (archive.endsWith('.zip')) spawnSync('unzip', ['-q', resolve(archive), '-d', work], { stdio: 'inherit' });
else spawnSync('tar', ['-xzf', resolve(archive), '-C', work], { stdio: 'inherit' });
const top = (await readdir(work)).find((name) => name.startsWith('uxqa-'));
if (!top) throw new Error('包里没有 uxqa-* 文件夹');
const dir = join(work, top);
const win = process.platform === 'win32';
const uxqa = join(dir, win ? 'uxqa.cmd' : 'uxqa');
const env = { ...process.env, UXQA_HOME: home, ...(noBrowser ? { PLAYWRIGHT_BROWSERS_PATH: join(work, 'no-browsers') } : {}) };
console.log(`解压到 ${dir}${noBrowser ? '（模拟没有浏览器组件）' : ''}`);

// 1. uxqa check: same output and exit code as the source build, run from an unrelated folder.
const packaged = spawnSync(uxqa, ['check', '--source', fixture], { cwd: work, env, encoding: 'utf8', shell: win });
const source = spawnSync(process.execPath, [join(ROOT, 'dist/src/cli.js'), 'check', '--source', fixture], { cwd: work, env, encoding: 'utf8' });
const clean = (text) => text.split('\n').filter((line) => !/trust settings of system certificate/.test(line)).join('\n');
if (packaged.status === source.status && clean(packaged.stdout) === clean(source.stdout) && clean(packaged.stdout).length > 0) ok('uxqa check', `退出码 ${packaged.status}，输出和源码版一致（${clean(packaged.stdout).split('\n').length} 行）`);
else bad('uxqa check', `退出码 ${packaged.status}/${source.status}；${clean(packaged.stderr).slice(0, 300)}`);

// 2. uxqa ui
async function startUi(command, args) {
  const child = spawn(command, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'], shell: win });
  let output = '';
  const url = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`20 秒内没有启动：${output}`)), 20000);
    const feed = (chunk) => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#t=[\w-]+/); if (match) { clearTimeout(timer); done(match[0]); } };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('exit', (code) => { clearTimeout(timer); fail(new Error(`提前退出（${code}）：${output}`)); });
  });
  return { child, url };
}
const stop = (child) => { child.removeAllListeners('exit'); child.kill(); };

try {
  const { child, url } = await startUi(uxqa, ['ui', '--no-open', '--port', '0']);
  const base = url.replace(/\/#t=.*/, '');
  const token = url.split('#t=')[1];
  const api = async (path, options = {}) => {
    const reply = await fetch(`${base}/api${path}`, { method: options.method ?? 'GET', headers: { 'x-uxqa-token': token, ...(options.body ? { 'content-type': 'application/json' } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
    return { status: reply.status, data: await reply.json().catch(() => ({})) };
  };
  try {
    const page = await fetch(`${base}/`);
    const html = await page.text();
    const script = await fetch(`${base}/app.js`);
    const projects = await api('/projects');
    if (page.status === 200 && /<html/i.test(html) && script.status === 200 && projects.status === 200) ok('uxqa ui', `${base} 页面、脚本、接口都正常`);
    else bad('uxqa ui', `页面 ${page.status}，脚本 ${script.status}，接口 ${projects.status}`);
    const browser = await api('/browser');
    if (browser.status === 200 && browser.data.browser.ready === !noBrowser) ok('浏览器组件状态', browser.data.browser.ready ? `已就绪（${browser.data.browser.location}）` : `未下载；会提示 ${browser.data.browser.files.map((file) => file.name).join('、')}，来源 ${browser.data.browser.source}，保存到 ${browser.data.browser.location}`);
    else bad('浏览器组件状态', JSON.stringify(browser.data).slice(0, 300));
    if (noBrowser) {
      const added = await api('/projects', { method: 'POST', body: { path: fixture } });
      const id = added.data.project?.id;
      await api(`/projects/${id}/settings`, { method: 'POST', body: { baseUrl: 'http://127.0.0.1:9', routes: '/' } });
      const asked = await api(`/projects/${id}/check`, { method: 'POST' });
      if (asked.status === 409 && asked.data.browser?.files?.length) ok('没装浏览器时先询问', `"${asked.data.error}"，不会自动下载`);
      else bad('没装浏览器时先询问', `${asked.status} ${JSON.stringify(asked.data).slice(0, 200)}`);
      const started = await api(`/projects/${id}/check`, { method: 'POST', body: { skipPages: true } });
      let job = started.data.job;
      for (let i = 0; i < 100 && job?.state === 'running'; i++) { await new Promise((done) => setTimeout(done, 300)); job = (await api(`/projects/${id}/jobs/${job.id}`)).data.job; }
      const round = job?.roundId ? (await api(`/projects/${id}/rounds/${job.roundId}`)).data.round : undefined;
      if (job?.state === 'done' && round?.partial?.includes('浏览器组件') && round.result.violations.length > 0) ok('不同意下载时源码检查照常', `${round.result.violations.length} 个问题；提示："${round.partial.slice(0, 40)}…"`);
      else bad('不同意下载时源码检查照常', `${job?.state} ${job?.error ?? ''} ${round?.partial ?? ''}`);
      const install = await api('/browser/install', { method: 'POST', body: {} });
      if (install.status === 400) ok('没确认不能下载', install.data.error);
      else bad('没确认不能下载', `${install.status}`);
    }
  } finally { stop(child); }
} catch (error) { bad('uxqa ui', error.message); }

// 3. uxqa mcp
await new Promise((done) => {
  const child = spawn(uxqa, ['mcp'], { cwd: fixture, env, stdio: ['pipe', 'pipe', 'pipe'], shell: win });
  let output = '';
  const finish = (message) => { clearTimeout(timer); child.kill(); message(); done(); };
  const timer = setTimeout(() => finish(() => bad('uxqa mcp', `10 秒内没有回应：${output.slice(0, 300)}`)), 10000);
  child.stdout.on('data', (chunk) => {
    output += chunk;
    const list = output.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return undefined; } }).find((reply) => reply?.id === 2);
    if (list) finish(() => (list.result?.tools?.length ? ok('uxqa mcp', `${list.result.tools.length} 个工具：${list.result.tools.map((tool) => tool.name).join('、')}`) : bad('uxqa mcp', JSON.stringify(list).slice(0, 300))));
  });
  for (const message of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]) child.stdin.write(`${JSON.stringify(message)}\n`);
});

// 4. uxqa browser and the double-click launcher
const status = spawnSync(uxqa, ['browser'], { cwd: work, env, encoding: 'utf8', shell: win });
if (status.status === 0 && /浏览器组件：/.test(status.stdout)) ok('uxqa browser', status.stdout.split('\n')[0]); else bad('uxqa browser', status.stderr.slice(0, 200));
const launcher = (await readdir(dir)).find((name) => /\.(command|cmd)$/.test(name) && name !== 'uxqa.cmd' || name === 'open-uxqa-console.sh');
try {
  const { child, url } = await startUi(join(dir, launcher), ['--no-open', '--port', '0']);
  stop(child);
  ok(`双击启动文件「${launcher}」`, url.replace(/#t=.*/, ''));
} catch (error) { bad(`双击启动文件「${launcher}」`, error.message); }

if (!argv.includes('--keep')) await rm(work, { recursive: true, force: true });
const failed = results.filter((result) => !result.ok).length;
console.log(failed ? `\n${failed} 项没通过` : `\n全部 ${results.length} 项通过`);
process.exitCode = failed ? 1 : 0;
