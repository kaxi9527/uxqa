import { lstat, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { dataDir, shotsDir, type Round } from './store.js';
import { cleanExportedScreenshots } from './exported-screenshot-retention.js';

export const SCREENSHOT_RETENTION_MS = 48 * 60 * 60 * 1000;
const GENERATED_IMAGE = /^(?:page-[a-z0-9-]+-[a-f0-9]{6}|issue-\d+-[a-z0-9-]+-[a-f0-9]{6}|(?:view|visual|change)-[a-f0-9]{10})\.png$/i;
const ROUND_DIRECTORY = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-shots$/;
const MANIFEST = '.expired-screenshots.json';

/** Names are retained separately from the round so historical findings are never rewritten. */
export async function expiredScreenshotNames(projectId: string, roundId: string): Promise<Set<string>> {
  try {
    const names: unknown = JSON.parse(await readFile(join(shotsDir(projectId, roundId), MANIFEST), 'utf8'));
    return new Set(Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : []);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
}

/** Remove only UXQA-generated PNGs from managed round directories, never exports or project files. */
export async function cleanExpiredScreenshots(now = Date.now()): Promise<number> {
  const root = join(dataDir(), 'rounds');
  const projects = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  let removed = await cleanExportedScreenshots(now - SCREENSHOT_RETENTION_MS);
  for (const project of projects) {
    if (!project.isDirectory() || !/^[a-f0-9]{12}$/.test(project.name)) continue;
    for (const round of await readdir(join(root, project.name), { withFileTypes: true })) {
      if (!round.isDirectory() || !ROUND_DIRECTORY.test(round.name)) continue;
      const directory = join(root, project.name, round.name);
      const roundId = round.name.slice(0, -'-shots'.length);
      const expired = await expiredScreenshotNames(project.name, roundId);
      let changed = false;
      try {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (!entry.isFile() || !GENERATED_IMAGE.test(entry.name)) continue;
          const path = join(directory, entry.name);
          const info = await lstat(path);
          if (!info.isFile() || info.mtimeMs > now - SCREENSHOT_RETENTION_MS) continue;
          await unlink(path);
          expired.add(entry.name);
          changed = true;
          removed++;
        }
      } finally {
        if (changed) await writeFile(join(directory, MANIFEST), JSON.stringify([...expired]) + '\n', { mode: 0o600 });
      }
    }
  }
  return removed;
}

/** Create a view for readers without altering the saved record or its original evidence. */
export async function availableRoundScreenshots(projectId: string, round: Round): Promise<Round> {
  if (!round.capture) return round;
  const expired = await expiredScreenshotNames(projectId, round.id);
  const changes = await Promise.all((round.capture.changes ?? []).map(async (change) => {
    const previous = await expiredScreenshotNames(projectId, change.previousRound);
    return { ...change, imagesExpired: expired.has(basename(change.image)) || !!(change.diff && expired.has(basename(change.diff))) || previous.has(basename(change.previousImage)) };
  }));
  const captures = Object.fromEntries(Object.entries(round.capture.captures).map(([key, capture]) => {
    const shots = capture.shots.filter((shot) => !expired.has(basename(shot.crop)) && !expired.has(basename(shot.full)));
    return [key, { ...capture, shots, screenshotsExpired: shots.length < capture.shots.length }];
  }));
  return { ...round, screenshots: Object.values(captures).filter((capture) => capture.shots.length).length,
    capture: { ...round.capture, captures, views: (round.capture.views ?? []).filter((view) => !expired.has(basename(view.image))), changes,
      screenshotsExpired: expired.size > 0,
      pages: round.capture.pages.map((page) => page.screenshot && expired.has(basename(page.screenshot)) ? { ...page, screenshot: undefined } : page) } };
}
