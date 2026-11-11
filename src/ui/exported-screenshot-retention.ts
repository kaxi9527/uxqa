import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { dataDir } from './store.js';

interface RegisteredScreenshot { path: string; root: string; dev: number; ino: number; size: number; mtimeMs: number }
const registry = () => join(dataDir(), 'screenshot-runs');

/** Register only actual screenshot files produced directly in this run's output directory. */
export async function registerExportedScreenshots(output: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const outputPath = resolve(output), root = await realpath(outputPath);
  const images: RegisteredScreenshot[] = [];
  for (const candidate of new Set(paths)) {
    const candidatePath = resolve(candidate);
    if (!candidatePath.toLowerCase().endsWith('.png') || await realpath(dirname(candidatePath)).catch(() => '') !== root) continue;
    const path = join(root, basename(candidatePath));
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (!info?.isFile()) continue;
    images.push({ path, root, dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs });
  }
  if (!images.length) return;
  await mkdir(registry(), { recursive: true, mode: 0o700 });
  const manifest = join(registry(), `${createHash('sha256').update(root).digest('hex')}.json`);
  const existing = await readFile(manifest, 'utf8').then((text) => JSON.parse(text) as RegisteredScreenshot[])
    .catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  const updated = new Map(existing.map((image) => [image.path, image]));
  for (const image of images) updated.set(image.path, image);
  await writeFile(manifest, JSON.stringify([...updated.values()]) + '\n', { mode: 0o600 });
}

/** Historical default runs are imported only when their report names an unchanged PNG in that run directory. */
export async function registerHistoricalScreenshots(outputRoot: string): Promise<void> {
  const root = await realpath(outputRoot).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (!root) return;
  const historyDirectory = join(dataDir(), 'screenshot-history-roots');
  const marker = join(historyDirectory, `${createHash('sha256').update(root).digest('hex')}.done`);
  if (await lstat(marker).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; })) return;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/.test(entry.name)) continue;
    const output = join(root, entry.name);
    for (const reportName of ['report.json', 'components.json']) {
      const report = await readFile(join(output, reportName), 'utf8').then((text) => JSON.parse(text) as { endedAt?: string; artifacts?: unknown[]; observations?: Array<{ screenshot?: unknown }> }).catch(() => undefined);
      const endedAt = report?.endedAt ? Date.parse(report.endedAt) : NaN;
      if (!report || !Number.isFinite(endedAt)) continue;
      const paths = [...(Array.isArray(report.artifacts) ? report.artifacts : []), ...(Array.isArray(report.observations) ? report.observations.map((item) => item.screenshot) : [])]
        .filter((value): value is string => typeof value === 'string' && isAbsolute(value) && value.toLowerCase().endsWith('.png'));
      const unchanged: string[] = [];
      for (const path of paths) {
        if (await realpath(dirname(path)).catch(() => '') !== output) continue;
        const info = await lstat(path).catch(() => undefined);
        if (info?.isFile() && info.mtimeMs <= endedAt + 2000) unchanged.push(path);
      }
      await registerExportedScreenshots(output, unchanged);
    }
  }
  await mkdir(historyDirectory, { recursive: true, mode: 0o700 });
  await writeFile(marker, root + '\n', { mode: 0o600 });
}

export async function cleanExportedScreenshots(cutoff: number): Promise<number> {
  const files = await readdir(registry(), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  let removed = 0;
  for (const file of files) {
    if (!file.isFile() || !/^[a-f0-9]{64}\.json$/.test(file.name)) continue;
    const manifest = join(registry(), file.name);
    const images = JSON.parse(await readFile(manifest, 'utf8')) as RegisteredScreenshot[];
    const remaining: RegisteredScreenshot[] = [];
    for (const image of images) {
      if (!isAbsolute(image.path) || dirname(image.path) !== image.root || !image.path.toLowerCase().endsWith('.png')) continue;
      if (await realpath(image.root).catch(() => '') !== image.root) { remaining.push(image); continue; }
      const info = await lstat(image.path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (!info) { remaining.push(image); continue; }
      if (!info.isFile() || info.dev !== image.dev || info.ino !== image.ino || info.size !== image.size || info.mtimeMs !== image.mtimeMs) continue;
      if (info.mtimeMs > cutoff) { remaining.push(image); continue; }
      await unlink(image.path);
      removed++;
    }
    if (remaining.length) await writeFile(manifest, JSON.stringify(remaining) + '\n', { mode: 0o600 });
    else await unlink(manifest);
  }
  return removed;
}
