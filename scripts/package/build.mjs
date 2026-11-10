// Builds the download packages into release/: one archive per platform with the official Node runtime,
// the bundled app and launchers. The screenshot browser is NOT included; the console offers to download it on first use.
//   node scripts/package/build.mjs [--target all|darwin-arm64,darwin-x64,win-x64,linux-x64]
//   node scripts/package/build.mjs --target <this machine> --node <path to a local node 22 binary>   (test build, named *-localnode)
// Node runtimes come from release/.cache/ (node scripts/package/fetch-node.mjs downloads and verifies them).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { readSums, sha256, verified } from './fetch-node.mjs';
import { hostTarget, mib, NODE_CACHE, NODE_DIST, NODE_VERSION, pickTargets, RELEASE, ROOT, TARGETS } from './targets.mjs';
import { buildModelCore } from './model-core.mjs';

const argv = process.argv.slice(2);
const option = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
const ids = pickTargets(argv);
const localNode = option('--node');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const STAGE = join(RELEASE, '.stage');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${basename(command)} ${args.join(' ')} 失败（退出码 ${result.status}）`);
}

async function resolvePackage(name, from = join(ROOT, 'package.json')) {
  const require = createRequire(await realpath(from));
  try { return dirname(await realpath(require.resolve(`${name}/package.json`))); } catch { /* package.json not exported: walk up from the entry */ }
  let dir = dirname(await realpath(require.resolve(name)));
  for (; dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = await readFile(join(dir, 'package.json'), 'utf8').then(JSON.parse, () => undefined);
    if (manifest?.name === name) return dir;
  }
  throw new Error(`找不到 ${name} 的安装目录`);
}

// ---------- 1. app bundle (same for every platform) ----------
async function buildApp() {
  console.log('构建 dist/ …');
  run(process.execPath, [join(ROOT, 'scripts/embed-ui.mjs')]);
  run(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.json')]);
  const app = option('--app-out') ?? join(STAGE, 'app');
  await rm(app, { recursive: true, force: true });
  await mkdir(app, { recursive: true });
  // esbuild is already installed as tsx's dependency; no extra download.
  const esbuild = createRequire(await realpath(join(ROOT, 'node_modules/tsx/package.json')))('esbuild');
  console.log('打包 app/uxqa.mjs …');
  const result = await esbuild.build({
    entryPoints: { uxqa: join(ROOT, 'dist/src/cli.js'), desktop: join(ROOT, 'dist/src/desktop/main.js') },
    outdir: app, bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'node22',
    outExtension: { '.js': '.mjs' }, chunkNames: 'chunks/[name]-[hash]', legalComments: 'eof', logLevel: 'warning', metafile: true,
    // Kept as real files: Playwright and axe read their own files at run time; TypeScript relies on __filename.
    external: ['playwright', 'playwright-core', '@axe-core/playwright', 'typescript'],
    banner: { js: "import { createRequire as __uxqaCreateRequire } from 'node:module'; const require = __uxqaCreateRequire(import.meta.url);" },
  });
  const outputs = Object.keys(result.metafile.outputs).length;
  const licenses = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes('node_modules')) continue;
    let folder = dirname(join(ROOT, input));
    for (; folder !== dirname(folder); folder = dirname(folder)) {
      const meta = await readFile(join(folder, 'package.json'), 'utf8').then(JSON.parse, () => null);
      if (!meta?.name) continue;
      const key = `${meta.name}@${meta.version}`;
      if (!licenses.has(key)) {
        const files = (await readdir(folder)).filter((file) => /^(license|licence|copying|notice)(\.|$)/i.test(file));
        licenses.set(key, `=== ${key} (${meta.license ?? 'see notice'}) ===\n${(await Promise.all(files.map((file) => readFile(join(folder, file), 'utf8')))).join('\n')}`);
      }
      break;
    }
  }
  await writeFile(join(app, 'THIRD-PARTY-NOTICES.txt'), [...licenses.values()].sort().join('\n\n'));
  const modules = join(app, 'node_modules');
  const playwright = await resolvePackage('playwright');
  const axe = await resolvePackage('@axe-core/playwright');
  const copies = [
    ['playwright', playwright],
    ['playwright-core', await resolvePackage('playwright-core', join(playwright, 'package.json'))],
    ['@axe-core/playwright', axe],
    ['axe-core', await resolvePackage('axe-core', join(axe, 'package.json'))],
  ];
  for (const [name, from] of copies) await cp(from, join(modules, name), { recursive: true, dereference: true, filter: (path) => !/(^|\/)(node_modules|\.DS_Store)$/.test(path.slice(from.length)) });
  // TypeScript: only the compiler API file and its licence (the rest is the tsc/tsserver tooling, about 10 MiB).
  const ts = await resolvePackage('typescript');
  await mkdir(join(modules, 'typescript/lib'), { recursive: true });
  for (const file of ['package.json', 'LICENSE.txt', 'ThirdPartyNoticeText.txt', 'lib/typescript.js']) await copyFile(join(ts, file), join(modules, 'typescript', file));
  await writeFile(join(app, 'package.json'), `${JSON.stringify({ name: pkg.name, version: VERSION, private: true, type: 'module' }, null, 2)}\n`);
  const versions = Object.fromEntries(await Promise.all(copies.map(async ([name]) => [name, JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8')).version])));
  versions.typescript = JSON.parse(await readFile(join(ts, 'package.json'), 'utf8')).version;
  console.log(`  ${outputs} 个文件；随包依赖 ${Object.entries(versions).map(([name, version]) => `${name}@${version}`).join('、')}`);
  return { app, versions };
}

// ---------- 2. browser download sizes per platform (shown before the person agrees, when the host cannot be reached) ----------
async function browserSizes(app, target) {
  const cli = join(app, 'node_modules/playwright-core/cli.js');
  const result = spawnSync(process.execPath, [cli, 'install', '--dry-run', '--only-shell', 'chromium'], { encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: TARGETS[target].playwrightHost } });
  const urls = [...(result.stdout ?? '').matchAll(/Download url:\s*(\S+)/g)].map((match) => match[1]);
  const sizes = {};
  for (const url of urls) {
    try {
      const reply = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      const length = Number(reply.headers.get('content-length'));
      if (reply.ok && length > 0) sizes[url] = length;
    } catch { /* offline build: the console then asks the host itself */ }
  }
  return { urls, sizes };
}

// ---------- 3. Node runtime ----------
async function nodeRuntime(target, into) {
  const spec = TARGETS[target];
  const binary = join(into, basename(spec.node));
  if (localNode) {
    if (target !== hostTarget()) throw new Error(`--node 只能用来打本机平台（${hostTarget()}）的测试包`);
    const version = execFileSync(localNode, ['--version'], { encoding: 'utf8' }).trim();
    if (!version.startsWith('v22.')) throw new Error(`--node 需要 Node 22，这个是 ${version}`);
    await copyFile(localNode, binary);
    await chmod(binary, 0o755);
    return { version, source: 'local Node runtime (development build)', sha256: await sha256(binary) };
  }
  const archive = join(NODE_CACHE, spec.archive);
  if (!await verified(spec.archive)) throw new Error(`缺少校验过的 ${spec.archive}。先运行：node scripts/package/fetch-node.mjs --target ${target}`);
  const top = spec.archive.replace(/\.(tar\.gz|tar\.xz|zip)$/, '');
  const temp = await mkdtemp(join(tmpdir(), 'uxqa-node-'));
  try {
    if (spec.archive.endsWith('.zip')) run('tar', ['-xf', archive, '-C', temp, `${top}/${spec.node}`, `${top}/LICENSE`]);
    else run('tar', ['-xf', archive, '-C', temp, `${top}/${spec.node}`, `${top}/LICENSE`]);
    await copyFile(join(temp, top, spec.node), binary);
    await copyFile(join(temp, top, 'LICENSE'), join(into, 'LICENSE'));
    if (spec.os !== 'win32') await chmod(binary, 0o755);
  } finally { await rm(temp, { recursive: true, force: true }); }
  return { version: NODE_VERSION, source: `${NODE_DIST}/${spec.archive}`, sha256: (await readSums()).get(spec.archive) };
}

// ---------- 4. launchers and the readme ----------
const SH_UXQA = `#!/bin/sh
# uxqa: runs the bundled app with the bundled Node. Works through symlinks, e.g. ln -s "$PWD/uxqa" /usr/local/bin/uxqa
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in /*) self=$link ;; *) self=$(dirname -- "$self")/$link ;; esac
done
here=$(CDPATH= cd -- "$(dirname -- "$self")" && pwd)
export UXQA_MODEL_CORE="$here/model-core/uxqa-model-core"
exec "$here/runtime/node" "$here/app/uxqa.mjs" "$@"
`;
const SH_OPEN = `#!/bin/sh
# Opens the uxqa console in your browser. Keep this window open while you use it; close it (or press Ctrl+C) to stop.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$here/uxqa" ui "$@"
`;
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');
const CMD_UXQA = crlf(`@echo off
rem uxqa: runs the bundled app with the bundled Node.
set "UXQA_MODEL_CORE=%~dp0model-core\\uxqa-model-core.exe"
"%~dp0runtime\\node.exe" "%~dp0app\\uxqa.mjs" %*
exit /b %ERRORLEVEL%
`);
const CMD_OPEN = crlf(`@echo off
rem Opens the uxqa console in your browser. Keep this window open while you use it; close it to stop.
title uxqa
set "UXQA_MODEL_CORE=%~dp0model-core\\uxqa-model-core.exe"
"%~dp0runtime\\node.exe" "%~dp0app\\uxqa.mjs" ui %*
if errorlevel 1 pause
`);

function readme(target, names) {
  const win = TARGETS[target].os === 'win32';
  const cmd = win ? 'uxqa.cmd' : './uxqa';
  const lines = [
    `uxqa ${VERSION}（${target}）`,
    '',
    '怎么打开',
    `  双击「${names.open}」，浏览器会打开 uxqa 控制台。用的时候别关那个黑色窗口；关掉它（或按 Ctrl+C）就停止。`,
    '  控制台只有这台电脑能访问。',
    ...(TARGETS[target].os === 'darwin' ? [
      '  第一次打开时 macOS 可能提示"无法验证开发者"：到 系统设置 → 隐私与安全性，在下方点"仍要打开"。',
      '  请先核对 Release 的 SHA256SUMS.txt，并参阅 LOCAL-DATA-AND-PERMISSIONS.md；不要全局关闭系统保护。',
    ] : []),
    ...(win ? ['  第一次打开时 Windows 可能提示"Windows 已保护你的电脑"：点"更多信息"→"仍要运行"。'] : []),
    ...(TARGETS[target].os === 'linux' ? ['  如果双击没反应，在终端里进入这个文件夹运行：./open-uxqa-console.sh'] : []),
    '',
    '命令行',
    `  在这个文件夹里：${cmd} check --source <你的项目目录>   检查组件用法`,
    `                ${cmd} ui                            打开控制台`,
    `                ${cmd} mcp                           给 AI 助手用的 MCP 服务（在控制台"设置"里有现成的接入写法）`,
    `                ${cmd} browser                       看浏览器组件在不在`,
    '',
    '浏览器组件',
    '  给页面截图要用一个浏览器，约 100 MiB，没有放进安装包。第一次截图时控制台会告诉你文件名、来源和大小，你点"同意下载"才下载；',
    '  不下载的话，源码检查照常能用。',
    `  默认保存在 Playwright 的公共位置（${win ? '%LOCALAPPDATA%\\ms-playwright' : TARGETS[target].os === 'darwin' ? '~/Library/Caches/ms-playwright' : '~/.cache/ms-playwright'}），想换位置可以设置环境变量 PLAYWRIGHT_BROWSERS_PATH。`,
    '  网络连不上默认地址时，可以设置 PLAYWRIGHT_DOWNLOAD_HOST 用镜像。',
    ...(TARGETS[target].os === 'linux' ? ['  Linux 上浏览器还需要一些系统库；截图报缺少库时运行：sudo ./runtime/node ./app/node_modules/playwright-core/cli.js install-deps chromium'] : []),
    '',
    '数据放在哪',
    `  控制台数据默认在 ${win ? '%USERPROFILE%\\.uxqa' : '~/.uxqa'}；模型凭据在其中的 model-core。CLI 报告在指定输出位置。`,
    '  AI 看图复核会向所选模型发送截图和复核上下文；详见 LOCAL-DATA-AND-PERMISSIONS.md。',
    '',
    '卸载',
    `  先退出，再删应用文件夹。需要清除数据时，单独备份/删除 ${win ? '%USERPROFILE%\\.uxqa' : '~/.uxqa'}；浏览器缓存可能被其他工具共用。`,
    '',
    '里面有什么',
    '  runtime/   Node.js 官方运行时（许可证见 runtime/LICENSE）',
    '  model-core/   UXQA 自己的协议与订阅授权模块，源码编译，不需要另开模型管理产品',
    '  app/       uxqa 本体和它要用的 Playwright、axe-core、TypeScript（各自的许可证在 app/node_modules 里）',
    '  BUILD-INFO.json  这个包是怎么打出来的',
    '',
  ];
  return lines.join(win ? '\r\n' : '\n');
}

function gitRevision() {
  try {
    const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch { return { commit: 'unknown', dirty: true }; }
}

// ---------- 5. one package ----------
async function packageTarget(target, app, versions) {
  const spec = TARGETS[target];
  const name = `uxqa-${VERSION}-${target}${localNode ? '-localnode' : ''}`;
  const dir = join(STAGE, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'runtime'), { recursive: true });
  await cp(app, join(dir, 'app'), { recursive: true });
  const node = await nodeRuntime(target, join(dir, 'runtime'));
  await buildModelCore(target, join(dir, 'model-core'));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(join(ROOT, name), join(dir, name));
  await copyFile(join(ROOT, 'docs/local-data-and-permissions.md'), join(dir, 'LOCAL-DATA-AND-PERMISSIONS.md'));
  await copyFile(join(ROOT, 'assets/icon.png'), join(dir, 'icon.png'));
  const browser = await browserSizes(app, target);
  await writeFile(join(dir, 'app/browser-sizes.json'), `${JSON.stringify(browser.sizes, null, 2)}\n`);
  const names = spec.os === 'win32' ? { open: 'Open uxqa console.cmd', cli: 'uxqa.cmd' } : spec.os === 'darwin' ? { open: '打开 uxqa 控制台.command', cli: 'uxqa' } : { open: 'open-uxqa-console.sh', cli: 'uxqa' };
  if (spec.os === 'win32') {
    await writeFile(join(dir, names.cli), CMD_UXQA);
    await writeFile(join(dir, names.open), CMD_OPEN);
  } else {
    await writeFile(join(dir, names.cli), SH_UXQA, { mode: 0o755 });
    await writeFile(join(dir, names.open), SH_OPEN, { mode: 0o755 });
  }
  await writeFile(join(dir, 'README.txt'), `${spec.os === 'win32' ? '﻿' : ''}${readme(target, names)}`);
  const info = { name: 'uxqa', version: VERSION, target, builtAt: new Date().toISOString(), source: gitRevision(), node, bundled: versions, browser: { included: false, downloadUrls: browser.urls, sizes: browser.sizes } };
  await writeFile(join(dir, 'BUILD-INFO.json'), `${JSON.stringify(info, null, 2)}\n`);
  const file = join(RELEASE, `${name}.${spec.format}`);
  await rm(file, { force: true });
  // Archives keep the top folder and the executable bits; no macOS resource forks or extended attributes.
  if (spec.format === 'zip' && process.platform === 'win32') run('powershell', ['-NoProfile', '-Command', 'Compress-Archive -LiteralPath $env:UXQA_ARCHIVE_SOURCE -DestinationPath $env:UXQA_ARCHIVE_DEST -CompressionLevel Optimal'], { env: { ...process.env, UXQA_ARCHIVE_SOURCE: dir, UXQA_ARCHIVE_DEST: file } });
  else if (spec.format === 'zip') run('zip', ['-q', '-r', '-X', '-y', file, name], { cwd: STAGE });
  else run('tar', ['-czf', file, '-C', STAGE, ...(process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs'] : []), name], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const size = (await stat(file)).size;
  console.log(`✓ ${basename(file)}  ${mib(size)}（Node ${node.version}${localNode ? '，本机 Node 测试包' : ''}；浏览器组件大小 ${Object.keys(browser.sizes).length ? '已记录' : '未能读取'}）`);
  return file;
}

async function writeSums() {
  const files = (await readdir(RELEASE)).filter((name) => /^uxqa-.*\.(zip|tar\.gz)$/.test(name)).sort();
  const lines = [];
  for (const name of files) {
    const hash = createHash('sha256').update(await readFile(join(RELEASE, name))).digest('hex');
    lines.push(`${hash}  ${name}`);
  }
  await writeFile(join(RELEASE, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
}

await mkdir(STAGE, { recursive: true });
const { app, versions } = await buildApp();
if (argv.includes('--app-only')) process.exit(0);
const built = [];
const failed = [];
for (const target of ids) {
  try { built.push(await packageTarget(target, app, versions)); }
  catch (error) { failed.push(target); console.error(`✗ ${target}：${error instanceof Error ? error.message : error}`); }
}
await writeSums();
console.log(`\n产物在 ${RELEASE}（SHA256SUMS.txt 已更新）。${failed.length ? `没打成：${failed.join('、')}` : ''}`);
process.exitCode = failed.length ? 1 : 0;
