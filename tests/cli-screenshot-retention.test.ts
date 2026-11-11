import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { cleanExpiredScreenshots, SCREENSHOT_RETENTION_MS } from '../src/ui/screenshot-retention.js';
import { registerExportedScreenshots, registerHistoricalScreenshots } from '../src/ui/exported-screenshot-retention.js';

it('cleans registered CLI screenshots without deleting modified, unregistered, or linked files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-cli-retention-home-'));
  const output = await mkdtemp(join(tmpdir(), 'uxqa-cli-output-'));
  const external = await mkdtemp(join(tmpdir(), 'uxqa-cli-external-'));
  const prior = process.env.UXQA_HOME;
  process.env.UXQA_HOME = home;
  try {
    const old = join(output, 'old.png'), recent = join(output, 'recent.png'), modified = join(output, 'modified.png');
    const own = join(output, 'personal.png'), outside = join(external, 'outside.png'), link = join(output, 'linked.png');
    await Promise.all([old, recent, modified, own, outside].map((file) => writeFile(file, 'original')));
    if (process.platform !== 'win32') await symlink(outside, link);
    const oldTime = new Date(Date.now() - SCREENSHOT_RETENTION_MS - 5000);
    await Promise.all([old, modified, own, outside].map((file) => utimes(file, oldTime, oldTime)));
    await registerExportedScreenshots(output, [old, recent, modified, link, outside]);
    const reused = join(output, 'reused-output.png');
    await writeFile(reused, 'new generated screenshot');
    await utimes(reused, oldTime, oldTime);
    await registerExportedScreenshots(output, [reused]);
    await writeFile(modified, 'changed by the user');
    expect(await cleanExpiredScreenshots()).toBe(2);
    await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(reused)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const path of [recent, modified, own, outside, ...(process.platform === 'win32' ? [] : [link])]) await expect(stat(path)).resolves.toBeDefined();
    expect(await readFile(modified, 'utf8')).toBe('changed by the user');
    expect((await readdir(join(home, 'screenshot-runs'))).length).toBe(1);
  } finally {
    if (prior === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = prior;
    await rm(home, { recursive: true, force: true }); await rm(output, { recursive: true, force: true }); await rm(external, { recursive: true, force: true });
  }
});

it('registers screenshots produced by the real run and components commands', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-cli-integration-home-'));
  const workspace = await mkdtemp(join(tmpdir(), 'uxqa-cli-integration-'));
  await mkdir(resolve('.ai-output'), { recursive: true });
  const build = await mkdtemp(join(resolve('.ai-output'), 'cli-retention-build-'));
  const defaultOutput = join(workspace, 'default-output');
  await mkdir(defaultOutput);
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><html lang="en"><title>Fixture</title><main><h1>Fixture</h1><button type="button">Continue</button></main></html>'); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  const config = join(workspace, 'config.json');
  await writeFile(config, JSON.stringify({ baseUrl: `http://127.0.0.1:${address.port}`, routes: ['/'], viewports: [{ name: 'desktop', width: 800, height: 600 }], options: { axe: false, screenshots: true, trace: 'off' } }));
  const exec = promisify(execFile), cli = join(build, 'src', 'cli.js');
  const env = { ...process.env, UXQA_HOME: home, UXQA_OUTPUT_ROOT: defaultOutput };
  try {
    await exec(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--outDir', build], { env, timeout: 45_000 });
    for (const command of ['run', 'components']) {
      const output = join(workspace, `output-${command}`);
      let stderr = '';
      await exec(process.execPath, [cli, command, '--config', config, '--out', output, ...(command === 'components' ? ['--no-design-tokens'] : [])], { env, timeout: 45_000 }).catch((error: { code?: number; stderr?: string }) => { if (error.code !== 1) throw error; stderr = error.stderr ?? ''; });
      const reportText = await readFile(join(output, command === 'run' ? 'report.json' : 'components.json'), 'utf8').catch(() => { throw new Error(`${command} produced no report: ${stderr.slice(0, 800)}`); });
      const report = JSON.parse(reportText);
      const screenshots: string[] = command === 'run' ? report.artifacts.filter((item: string) => item.endsWith('.png')) : report.observations.flatMap((item: { screenshot?: string }) => item.screenshot ? [item.screenshot] : []);
      expect(screenshots.length, `${command} should produce screenshots; coverage=${JSON.stringify(report.coverage ?? report.checks?.slice(0, 2))}`).toBeGreaterThan(0);
      const records = await Promise.all((await readdir(join(home, 'screenshot-runs'))).map(async (file) => JSON.parse(await readFile(join(home, 'screenshot-runs', file), 'utf8')) as Array<{ path: string }>));
      const recorded = records.flat().map((item) => item.path);
      for (const screenshot of screenshots) expect(recorded.some((path) => basename(path) === basename(screenshot))).toBe(true);
    }
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(home, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true }); await rm(build, { recursive: true, force: true });
  }
}, 120_000);

it('recognizes unchanged screenshots in historical default-run reports', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-cli-history-home-'));
  const root = await mkdtemp(join(tmpdir(), 'uxqa-cli-history-'));
  const prior = process.env.UXQA_HOME;
  process.env.UXQA_HOME = home;
  try {
    const output = join(root, '2026-10-01T00-00-00-000Z-12345678');
    await mkdir(output);
    const listed = join(output, 'listed.png'), personal = join(output, 'personal.png');
    await writeFile(listed, 'generated screenshot'); await writeFile(personal, 'not in report');
    const when = new Date(Date.now() - SCREENSHOT_RETENTION_MS - 5000);
    await utimes(listed, when, when); await utimes(personal, when, when);
    await writeFile(join(output, 'report.json'), JSON.stringify({ endedAt: new Date(when.getTime() + 1000).toISOString(), artifacts: [listed] }));
    await registerHistoricalScreenshots(root);
    expect(await cleanExpiredScreenshots()).toBe(1);
    await expect(stat(listed)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(personal)).resolves.toBeDefined();
    await expect(stat(join(output, 'report.json'))).resolves.toBeDefined();
  } finally {
    if (prior === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = prior;
    await rm(home, { recursive: true, force: true }); await rm(root, { recursive: true, force: true });
  }
});
