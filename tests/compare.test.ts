import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareViews } from '../src/visual/compare.js';

/** A white PNG with an optional dark block (x, y, width, height). */
function png(width: number, height: number, block?: [number, number, number, number]): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0;
    if (block && y >= block[1] && y < block[1] + block[3]) for (let x = block[0]; x < block[0] + block[2]; x++) row.fill(20, 1 + x * 3, 4 + x * 3);
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uxqa-compare-'));
  await writeFile(join(dir, 'home-old.png'), png(100, 100, [0, 0, 10, 10]));
  await writeFile(join(dir, 'home-new.png'), png(100, 100, [0, 0, 10, 10]));
  await writeFile(join(dir, 'list-old.png'), png(100, 100));
  await writeFile(join(dir, 'list-new.png'), png(100, 100, [50, 50, 20, 10]));
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('before/after page comparison', () => {
  it('reports no change for identical screens and the changed share for different ones', async () => {
    const changes = await compareViews(
      { round: 'r1', views: [{ route: '/', width: 1440, image: join(dir, 'home-old.png') }, { route: '/list', width: 1440, image: join(dir, 'list-old.png') }] },
      [{ route: '/', width: 1440, image: join(dir, 'home-new.png') }, { route: '/list', width: 1440, image: join(dir, 'list-new.png') }, { route: '/new', width: 1440, image: join(dir, 'home-new.png') }],
      (view) => join(dir, `diff${view.route.replace(/\W/g, '-')}.png`),
    );
    expect(changes.map((change) => [change.route, change.percent])).toEqual([['/', 0], ['/list', 2]]);
    expect(changes[0].diff).toBeUndefined();
    expect((await stat(changes[1].diff!)).size).toBeGreaterThan(100);
    expect(changes[1].previousRound).toBe('r1');
  }, 60_000);

  it('does nothing without a previous round', async () => {
    expect(await compareViews(undefined, [{ route: '/', width: 1440, image: join(dir, 'home-new.png') }], () => '')).toEqual([]);
  });
});
