import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { forgetAccessCheck, inspectDirectory, readAccessSettings, recheckPreviouslyAccessible, recordAccessCheck, updateAccessSettings } from '../src/ui/access.js';
import { discoverProjects } from '../src/ui/discover.js';
import { startConsole } from '../src/ui/server.js';

let home: string, project: string;
const previousHome = process.env.UXQA_HOME;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'uxqa-access-home-'));
  project = await mkdtemp(join(tmpdir(), 'uxqa-access-project-'));
  process.env.UXQA_HOME = home;
});
afterAll(async () => {
  if (previousHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previousHome;
  await rm(home, { recursive: true, force: true }); await rm(project, { recursive: true, force: true });
});

it('opens only the selected directory and persists an observation, not a permanent grant', async () => {
  const child = join(project, 'selected'); await mkdir(child);
  const privateName = 'do-not-return-this-filename.txt'; await writeFile(join(child, privateName), 'private');
  expect(await readAccessSettings()).toEqual({ locale: null, onboardingDone: false, checks: [] });
  await updateAccessSettings({ locale: 'en', onboardingDone: true });
  const saved = await recordAccessCheck(child);
  expect(saved.locale).toBe('en'); expect(saved.checks[0].result).toBe('accessible');
  expect(JSON.stringify(saved)).not.toContain(privateName);
  expect(JSON.parse(await readFile(join(home, 'access-settings.json'), 'utf8'))).toEqual(saved);
  await rename(child, `${child}-moved`);
  const after = await recheckPreviouslyAccessible();
  expect(after.changed[0].result).toBe('missing');
  expect(after.settings.checks[0].result).toBe('missing');
});

it('distinguishes missing directories and rejects relative paths without changing settings', async () => {
  const before = await readAccessSettings();
  expect((await inspectDirectory(join(project, 'missing'))).result).toBe('missing');
  await expect(recordAccessCheck('relative/path')).rejects.toThrow('INVALID_PATH');
  expect(await readAccessSettings()).toEqual(before);
  const forgotten = await forgetAccessCheck(before.checks[0].path);
  expect(forgotten.checks).toEqual([]);
  expect(await readFile(join(project, 'selected-moved', 'do-not-return-this-filename.txt'), 'utf8')).toBe('private');
});

it('does not silently report a missing discovery root as an empty scan', async () => {
  await expect(discoverProjects(join(project, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('protects access settings and validates request bodies at the API boundary', async () => {
  const server = await startConsole({ port: 0 });
  const url = new URL(server.url), token = new URLSearchParams(url.hash.slice(1)).get('t')!;
  const base = `${url.origin}/api/access`;
  try {
    expect((await fetch(base)).status).toBe(401);
    const request = (path: string, value: unknown) => fetch(base + path, { method: 'POST', headers: { 'x-uxqa-token': token, 'content-type': 'application/json' }, body: JSON.stringify(value) });
    expect((await request('', null)).status).toBe(400);
    expect((await request('', { locale: 'invalid' })).status).toBe(400);
    expect((await request('/check', { path: 'relative' })).status).toBe(400);
  } finally { await server.close(); }
});
