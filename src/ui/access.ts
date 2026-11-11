import { randomUUID } from 'node:crypto';
import { mkdir, opendir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { dataDir } from './store.js';

export type Locale = 'zh' | 'en';
export type AccessResult = 'accessible' | 'denied' | 'missing' | 'unavailable' | 'timed-out' | 'error';
export interface AccessCheck { path: string; result: AccessResult; checkedAt: string }
export interface AccessSettings { locale: Locale | null; onboardingDone: boolean; checks: AccessCheck[] }
const file = () => join(dataDir(), 'access-settings.json');

export async function readAccessSettings(): Promise<AccessSettings> {
  try { return JSON.parse(await readFile(file(), 'utf8')) as AccessSettings; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { locale: null, onboardingDone: false, checks: [] }; throw error; }
}

async function save(settings: AccessSettings) {
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const temporary = `${file()}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, file());
}

/** Actually opens the selected directory; the result is an observation, not a TCC grant. */
export async function inspectDirectory(path: string, timeoutMs = 30_000): Promise<AccessCheck> {
  const expanded = path.trim().replace(/^~(?=$|\/)/, homedir());
  if (!expanded || !isAbsolute(expanded) || expanded.length > 4096) throw new Error('INVALID_PATH');
  const absolute = resolve(expanded);
  let result: AccessResult;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = (async () => { const handle = await opendir(absolute); try { await handle.read(); } finally { await handle.close(); } })();
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Access check timed out'), { code: 'ETIMEDOUT' })), timeoutMs); });
    await Promise.race([read, timeout]);
    result = 'accessible';
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    result = code === 'EACCES' || code === 'EPERM' ? 'denied' : code === 'ENOENT' || code === 'ENOTDIR' ? 'missing'
      : code === 'ETIMEDOUT' ? 'timed-out' : code === 'ENETDOWN' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'EIO' ? 'unavailable' : 'error';
  }
  finally { if (timer) clearTimeout(timer); }
  return { path: absolute, result, checkedAt: new Date().toISOString() };
}

export async function recordAccessCheck(path: string): Promise<AccessSettings> {
  const check = await inspectDirectory(path);
  const settings = await readAccessSettings();
  settings.checks = [...settings.checks.filter((item) => item.path !== check.path), check];
  await save(settings);
  return settings;
}

export async function updateAccessSettings(input: { locale?: Locale; onboardingDone?: boolean }): Promise<AccessSettings> {
  const settings = await readAccessSettings();
  if (input.locale !== undefined) settings.locale = input.locale;
  if (input.onboardingDone !== undefined) settings.onboardingDone = input.onboardingDone;
  await save(settings);
  return settings;
}

export async function forgetAccessCheck(path: string): Promise<AccessSettings> {
  const settings = await readAccessSettings();
  settings.checks = settings.checks.filter((item) => item.path !== path);
  await save(settings);
  return settings;
}

export async function recheckPreviouslyAccessible(): Promise<{ settings: AccessSettings; changed: AccessCheck[] }> {
  const settings = await readAccessSettings(), changed: AccessCheck[] = [];
  for (let index = 0; index < settings.checks.length; index++) {
    const previous = settings.checks[index];
    if (previous.result !== 'accessible') continue;
    const current = await inspectDirectory(previous.path, 5000);
    settings.checks[index] = current;
    if (current.result !== 'accessible') changed.push(current);
  }
  if (settings.checks.length) await save(settings);
  return { settings, changed };
}
