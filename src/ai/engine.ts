import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from '../ui/store.js';

interface Engine { child: ChildProcess; baseUrl: string; token: string }
let running: Engine | undefined;
let starting: Promise<Engine> | undefined;

export async function engineStatus() {
  const binary = process.env.UXQA_MODEL_CORE;
  const available = !!binary && await access(binary).then(() => true, () => false);
  return { available, running: !!running };
}

async function stopChild(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.stdin?.end();
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

export async function stopEngine(): Promise<void> {
  if (starting) await starting.catch(() => undefined);
  const current = running;
  running = undefined;
  if (current) await stopChild(current.child);
}

/** UXQA-owned source-built module. Its private API is never exposed to the UI. */
export async function startEngine(): Promise<Engine> {
  if (running) return running;
  if (starting) return starting;
  starting = (async () => {
    const binary = process.env.UXQA_MODEL_CORE;
    if (!binary) throw new Error('当前版本没有模型模块，请使用 UXQA 桌面应用。');
    await access(binary).catch(() => { throw new Error('模型模块缺失，请重新解压完整应用。'); });
    const root = join(dataDir(), 'model-core');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const token = randomBytes(32).toString('hex');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MAGPIE_')));
    const child = spawn(binary, [], { cwd: root, stdio: ['pipe', 'pipe', 'ignore'], env: {
      ...env, UXQA_MODEL_HOME: root, UXQA_MODEL_TOKEN: token,
      CLAUDE_CONFIG_DIR: join(root, 'clients', 'claude'), CLAUDE_SECURESTORAGE_CONFIG_DIR: join(root, 'clients', 'claude'),
      XDG_CONFIG_HOME: join(root, 'clients', 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
    } });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        const timer = setTimeout(() => finish(new Error('模型模块启动超时')), 15000);
        const onExit = () => finish(new Error('模型模块启动失败，请重新打开应用'));
        const onError = () => finish(new Error('无法运行模型模块'));
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.length > 4096) return finish(new Error('模型模块返回无效状态'));
          if (!buffer.includes('\n')) return;
          try {
            const value = JSON.parse(buffer.split('\n')[0]);
            const parsed = new URL(value.url);
            if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) throw new Error();
            finish(undefined, parsed.origin);
          } catch { finish(new Error('模型模块返回无效地址')); }
        };
        function finish(error?: Error, url?: string) {
          clearTimeout(timer); child.off('exit', onExit); child.off('error', onError); child.stdout?.off('data', onData);
          if (error) reject(error); else resolve(url!);
        }
        child.once('error', onError); child.once('exit', onExit); child.stdout?.on('data', onData);
      });
      const result = { child, baseUrl: url, token };
      child.on('error', () => { if (running?.child === child) running = undefined; });
      child.once('exit', () => { if (running?.child === child) running = undefined; });
      // Make readiness observable before the owning UI reports success.
      const response = await fetch(`${url}/control/state`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('模型模块初始化失败');
      running = result;
      return result;
    } catch (error) { await stopChild(child); throw error; }
  })();
  try { return await starting; } finally { starting = undefined; }
}

export async function engineRequest(path: string, input?: unknown): Promise<unknown> {
  if (!/^\/(state|models|providers|provider-delete|account|login(?:\/[a-zA-Z0-9_-]+)?)$/.test(path)) throw new Error('无效的模型操作');
  const engine = await startEngine();
  const response = await fetch(`${engine.baseUrl}/control${path}`, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${engine.token}`, 'content-type': 'application/json' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(60000), redirect: 'error',
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? `模型操作失败（${response.status}）`);
  return result;
}

export async function engineConnection() {
  const engine = await startEngine();
  return { protocol: 'openai' as const, baseUrl: `${engine.baseUrl}/v1`, apiKey: engine.token };
}
