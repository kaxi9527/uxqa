import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';
import { runCheck } from '../src/check/run.js';
import type { CaptureReport } from '../src/capture/pages.js';
import { addProject, getRound, saveRound, shotsDir } from '../src/ui/store.js';
import { availableRoundScreenshots, cleanExpiredScreenshots, SCREENSHOT_RETENTION_MS } from '../src/ui/screenshot-retention.js';
import { startConsole } from '../src/ui/server.js';

afterEach(() => vi.useRealTimers());

it('cleans only expired managed screenshots and keeps records, exports, and newer files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-retention-home-'));
  const project = await mkdtemp(join(tmpdir(), 'uxqa-retention-project-'));
  const previousHome = process.env.UXQA_HOME;
  process.env.UXQA_HOME = home;
  let server: Awaited<ReturnType<typeof startConsole>> | undefined;
  try {
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'retention-fixture' }));
    await writeFile(join(project, 'Screen.tsx'), 'export const Screen = () => <div style={{color:"#ff0000"}}>Test</div>;');
    const entry = await addProject(project);
    const result = await runCheck({ source: project });
    const finding = result.violations[0];
    expect(finding).toBeDefined();
    const roundId = '2026-11-01T10-00-00-000Z';
    const directory = shotsDir(entry.id, roundId);
    await mkdir(directory, { recursive: true });
    const old = join(directory, 'issue-1-home-abcdef.png'), recent = join(directory, 'page-home-abcdef.png');
    const personal = join(directory, 'page-user.png'), projectImage = join(project, 'page-user.png'), timerImage = join(directory, 'view-abcdef0123.png');
    await Promise.all([old, recent, personal, projectImage, timerImage].map((file) => writeFile(file, 'fixture')));
    await writeFile(join(home, 'access-settings.json'), JSON.stringify({ locale: 'en', onboardingDone: true, checks: [] }));
    if (process.platform !== 'win32') await symlink(projectImage, join(directory, 'page-link-abcdef.png'));
    const now = Date.now(), older = new Date(now - SCREENSHOT_RETENTION_MS - 1000), newer = new Date(now - SCREENSHOT_RETENTION_MS + 60_000);
    await Promise.all([old, personal, projectImage].map((file) => utimes(file, older, older)));
    await utimes(recent, newer, newer);
    const capture: CaptureReport = { baseUrl: 'http://localhost', viewport: 'desktop', pages: [], cancelled: false, durationMs: 1,
      captures: { [finding.fingerprint]: { status: 'found', note: '', matches: 1, shots: [{ route: '/', viewport: 'desktop', crop: old, full: recent, matches: 1 }] } },
      views: [{ route: '/', width: 1000, image: recent }] };
    const saved = await saveRound(entry.id, result, { roundId, capture });
    const recordPath = join(home, 'rounds', entry.id, `${roundId}.json`);
    const originalRecord = await readFile(recordPath, 'utf8');

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    server = await startConsole({ port: 0 });
    await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(recent)).resolves.toBeDefined();
    await expect(stat(personal)).resolves.toBeDefined();
    await expect(stat(projectImage)).resolves.toBeDefined();
    expect(await readFile(recordPath, 'utf8')).toBe(originalRecord);
    const view = await availableRoundScreenshots(entry.id, saved);
    expect(view.capture?.captures[finding.fingerprint]).toMatchObject({ screenshotsExpired: true, shots: [] });
    expect(view.capture?.views).toHaveLength(1);
    expect((await getRound(entry.id, roundId))?.capture?.captures[finding.fingerprint].shots).toHaveLength(1);
    const later = { ...saved, id: '2026-11-02T10-00-00-000Z', capture: { ...capture,
      changes: [{ route: '/', width: 1000, previousRound: roundId, previousImage: old, image: recent, percent: 12 }] } };
    const comparison = await availableRoundScreenshots(entry.id, later);
    expect(comparison.capture?.changes?.[0]).toMatchObject({ imagesExpired: true, percent: 12 });

    const base = `http://127.0.0.1:${server.port}/api/projects/${entry.id}`;
    const response = await fetch(`${base}/shot?round=${roundId}&name=issue-1-home-abcdef.png&t=${server.token}`);
    expect(response.status).toBe(410);
    const roundResponse = await fetch(`${base}/rounds/${roundId}`, { headers: { 'x-uxqa-token': server.token } });
    const body = await roundResponse.json() as { round: { capture: { screenshotsExpired: boolean } } };
    expect(body.round.capture.screenshotsExpired).toBe(true);
    const retentionResponse = await fetch(`http://127.0.0.1:${server.port}/api/screenshot-retention`, { headers: { 'x-uxqa-token': server.token } });
    expect(await retentionResponse.json()).toMatchObject({ removed: 1, error: null });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(server.url);
      await page.getByRole('tab', { name: 'Issues', exact: true }).click();
      await page.getByText('Screenshots expired after 48 hours; the finding is still available. Run a new check for screenshots.').waitFor();
    } finally { await context.close(); await browser.close(); }

    expect(await cleanExpiredScreenshots(now)).toBe(0);
    expect(await cleanExpiredScreenshots(now + 60_001)).toBe(1);
    await expect(stat(recent)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(projectImage)).resolves.toBeDefined();
    await utimes(timerImage, older, older);
    await vi.advanceTimersByTimeAsync(60_000);
    await server.close(); server = undefined;
    await expect(stat(timerImage)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await server?.close();
    if (previousHome === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});
