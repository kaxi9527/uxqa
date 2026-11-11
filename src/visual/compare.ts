import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { PageView } from './audit.js';

/**
 * Before/after check for a page: the same route and width in the previous round vs this one.
 * Used after merging look-alike blocks into a component, where the page should look exactly the same.
 * The diff image dims the new screenshot and paints changed pixels red.
 */
export interface ViewChange { route: string; width: number; previousRound: string; previousImage: string; image: string; diff?: string; percent: number; imagesExpired?: boolean }

const COMPARE_SCRIPT = `async ([before, after]) => {
  const load = (src) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
  const [a, b] = await Promise.all([load(before), load(after)]);
  const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
  const read = (image) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0); return context.getImageData(0, 0, width, height); };
  const one = read(a), two = read(b);
  const out = new ImageData(width, height);
  let changed = 0;
  for (let i = 0; i < one.data.length; i += 4) {
    const delta = Math.max(Math.abs(one.data[i] - two.data[i]), Math.abs(one.data[i + 1] - two.data[i + 1]), Math.abs(one.data[i + 2] - two.data[i + 2]));
    if (delta > 24) { changed++; out.data[i] = 229; out.data[i + 1] = 72; out.data[i + 2] = 77; out.data[i + 3] = 255; }
    else { const grey = (two.data[i] + two.data[i + 1] + two.data[i + 2]) / 3; out.data[i] = out.data[i + 1] = out.data[i + 2] = 200 + grey * 0.2; out.data[i + 3] = 255; }
  }
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(out, 0, 0);
  return { percent: changed / (width * height) * 100, diff: changed ? canvas.toDataURL('image/png') : '' };
}`;

export async function compareViews(previous: { round: string; views: PageView[] } | undefined, current: PageView[], diffPath: (view: PageView) => string): Promise<ViewChange[]> {
  if (!previous || !current.length) return [];
  const before = new Map(previous.views.map((view) => [`${view.route}|${view.width}`, view]));
  const pairs = current.flatMap((view) => (before.has(`${view.route}|${view.width}`) ? [{ view, old: before.get(`${view.route}|${view.width}`)! }] : []));
  if (!pairs.length) return [];
  const browser = await chromium.launch();
  const changes: ViewChange[] = [];
  try {
    const page = await browser.newPage();
    for (const { view, old } of pairs) {
      const [a, b] = await Promise.all([readFile(old.image).catch(() => undefined), readFile(view.image).catch(() => undefined)]);
      if (!a || !b) continue;
      const url = (data: Buffer) => `data:image/png;base64,${data.toString('base64')}`;
      const result = await page.evaluate(`(${COMPARE_SCRIPT})(${JSON.stringify([url(a), url(b)])})`) as { percent: number; diff: string };
      let diff: string | undefined;
      if (result.diff) { diff = diffPath(view); await writeFile(diff, Buffer.from(result.diff.split(',')[1], 'base64')); }
      changes.push({ route: view.route, width: view.width, previousRound: previous.round, previousImage: old.image, image: view.image, ...(diff ? { diff } : {}), percent: Math.round(result.percent * 100) / 100 });
    }
  } finally {
    await browser.close();
  }
  return changes;
}
