import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hostTarget, ROOT } from './targets.mjs';
const version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
const args = process.argv.slice(2);
async function archives(dir) {
  return (await readdir(dir, { recursive: true })).filter((name) => /\.(zip|tar\.gz)$/.test(name)).map((name) => join(dir, name));
}
if (args[0] === '--smoke') {
  const files = await archives(join(ROOT, 'release'));
  if (files.length !== 1) throw new Error(`Expected one fresh release archive, found ${files.length}`);
  const r = spawnSync(process.execPath, ['scripts/package/smoke-release.mjs', files[0]], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
} else if (args[0] === '--assemble') {
  const dir = args[1];
  const files = await archives(dir);
  const expected = [`UXQA-${version}-macOS-arm64.zip`, `UXQA-${version}-macOS-x64.zip`, `uxqa-${version}-win-x64.zip`, `uxqa-${version}-linux-x64.tar.gz`, `uxqa-${version}-linux-arm64.tar.gz`].sort();
  if (JSON.stringify(files.map((file) => basename(file)).sort()) !== JSON.stringify(expected)) throw new Error('Release asset matrix is incomplete or has extra files');
  const out = join(dir, 'publish');
  await mkdir(out);
  const sums = [];
  for (const file of files.sort()) {
    await copyFile(file, join(out, basename(file)));
    sums.push(`${createHash('sha256').update(await readFile(file)).digest('hex')}  ${basename(file)}`);
  }
  await writeFile(join(out, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
} else {
  if (args[0] !== hostTarget()) throw new Error(`Expected native ${args[0]}, runner is ${hostTarget()}`);
  if (process.env.GITHUB_REF?.startsWith('refs/tags/') && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Tag must equal package.json version');
  console.log(`Verified version ${version}, target ${hostTarget()}`);
}
