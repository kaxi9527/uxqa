// Downloads the official Node runtimes the packages carry, into release/.cache/, and checks each against nodejs.org SHASUMS256.txt.
// Shows file names, source and sizes first and downloads only after a yes (or --yes).
//   node scripts/package/fetch-node.mjs [--target all|darwin-arm64,win-x64,...] [--yes]
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { mib, NODE_CACHE, NODE_DIST, NODE_VERSION, pickTargets, TARGETS } from './targets.mjs';

export async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

export async function readSums() {
  const text = await readFile(join(NODE_CACHE, 'SHASUMS256.txt'), 'utf8');
  return new Map(text.trim().split('\n').map((line) => line.trim().split(/\s+/)).map(([sum, name]) => [name, sum]));
}

/** True when the archive is in the cache and matches the official checksum. */
export async function verified(archive) {
  try {
    const sums = await readSums();
    return sums.get(archive) === await sha256(join(NODE_CACHE, archive));
  } catch { return false; }
}

async function size(url) {
  try {
    const reply = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return reply.ok ? Number(reply.headers.get('content-length')) || undefined : undefined;
  } catch { return undefined; }
}

async function download(url, file) {
  const reply = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!reply.ok || !reply.body) throw new Error(`${url} 返回 ${reply.status}`);
  await pipeline(Readable.fromWeb(reply.body), createWriteStream(`${file}.part`));
  await rename(`${file}.part`, file);
}

async function main() {
  const argv = process.argv.slice(2);
  const ids = pickTargets(argv);
  await mkdir(NODE_CACHE, { recursive: true });
  const wanted = [];
  for (const id of ids) if (!await verified(TARGETS[id].archive)) wanted.push(TARGETS[id].archive);
  if (!wanted.length) { console.log(`都已下载并校验过：${NODE_CACHE}`); return 0; }
  const haveSums = await stat(join(NODE_CACHE, 'SHASUMS256.txt')).then(() => true, () => false);
  const files = [...(haveSums ? [] : ['SHASUMS256.txt']), ...wanted];
  const sizes = await Promise.all(files.map((name) => size(`${NODE_DIST}/${name}`)));
  console.log(`将从 ${NODE_DIST}/ 下载（Node.js 官方，${NODE_VERSION}）：`);
  files.forEach((name, index) => console.log(`  ${name}  ${mib(sizes[index])}`));
  const total = sizes.reduce((sum, value) => sum + (value ?? 0), 0);
  console.log(`${sizes.every(Boolean) ? `合计 ${mib(total)}` : '有的文件读不到大小（可能网络不通）'}，保存到 ${NODE_CACHE}`);
  if (!argv.includes('--yes')) {
    if (!process.stdin.isTTY) { console.error('没有确认，所以没有下载。确认要下载请加 --yes。'); return 1; }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await prompt.question('同意下载吗？输入 y 回车开始：')).trim().toLowerCase();
    prompt.close();
    if (answer !== 'y' && answer !== 'yes') { console.log('已取消，没有下载任何东西。'); return 1; }
  }
  // The checksum list comes first, so every archive is checked the moment it arrives.
  if (!haveSums) await download(`${NODE_DIST}/SHASUMS256.txt`, join(NODE_CACHE, 'SHASUMS256.txt'));
  const sums = await readSums();
  for (const name of wanted) {
    if (!sums.has(name)) throw new Error(`SHASUMS256.txt 里没有 ${name}`);
    console.log(`下载 ${name} …`);
    const file = join(NODE_CACHE, name);
    await download(`${NODE_DIST}/${name}`, file);
    const actual = await sha256(file);
    if (actual !== sums.get(name)) { await rm(file, { force: true }); throw new Error(`${name} 校验不通过（应为 ${sums.get(name)}，实际 ${actual}），已删除`); }
    console.log(`  校验通过 sha256 ${actual}`);
  }
  await writeFile(join(NODE_CACHE, 'VERIFIED.txt'), `${new Date().toISOString()} verified against ${NODE_DIST}/SHASUMS256.txt\n${wanted.join('\n')}\n`, { flag: 'a' });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 2; });
}
