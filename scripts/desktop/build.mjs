// Local macOS application. Reuses installed, versioned runtimes; never downloads dependencies.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, realpath, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModelCore } from '../package/model-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('原生应用需在对应架构的 macOS 上构建。');
const target = `darwin-${process.arch}`;
const output = resolve(option('--out', join(root, 'release', `desktop-${new Date().toISOString().replace(/[:.]/g, '-')}`)));
const coreSource = join(root, 'native/model-core');
const license = join(coreSource, 'LICENSE');
const node = await realpath(process.execPath);
const nodeLicense = join(dirname(dirname(node)), 'LICENSE');
await access(nodeLicense);
await access(license);
// Refuse to overwrite another release directory.
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const app = join(output, 'UXQA.app');
const resources = join(app, 'Contents/Resources');
const bin = join(app, 'Contents/MacOS');
for (const path of [bin, join(resources, 'runtime'), join(resources, 'model-core')]) await mkdir(path, { recursive: true });
function run(command, argv, extra = {}) {
  const result = spawnSync(command, argv, { cwd: root, encoding: 'utf8', ...extra });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || '').slice(0, 1600)}`);
  return result.stdout.trim();
}
const hash = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
async function clone(source, target) {
  await copyFile(source, target, constants.COPYFILE_FICLONE);
  if (await hash(source) !== await hash(target)) throw new Error('Runtime copy hash mismatch');
}
run(node, ['scripts/package/build.mjs', '--app-only', '--app-out', join(resources, 'app')]);
await clone(node, join(resources, 'runtime/node'));
await clone(nodeLicense, join(resources, 'runtime/LICENSE'));
const coreBinary = join(resources, 'model-core/uxqa-model-core');
await buildModelCore(target, join(resources, 'model-core'));
await clone(license, join(resources, 'model-core/LICENSE'));
await clone(join(coreSource, 'UPSTREAM-MANIFEST.json'), join(resources, 'model-core/UPSTREAM-MANIFEST.json'));
await clone(join(coreSource, 'NOTICE.md'), join(resources, 'model-core/NOTICE.md'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>UXQA</string><key>CFBundleDisplayName</key><string>UXQA</string>
<key>CFBundleIdentifier</key><string>local.uxqa.desktop</string><key>CFBundleExecutable</key><string>UXQA</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${pkg.version}</string>
<key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>CFBundleIconFile</key><string>UXQA</string>
<key>NSDocumentsFolderUsageDescription</key><string>UXQA reads projects you select in Documents to check components and capture local QA evidence.</string>
<key>NSDesktopFolderUsageDescription</key><string>UXQA reads projects you select on the Desktop to check their source files.</string>
<key>NSDownloadsFolderUsageDescription</key><string>UXQA reads projects you select in Downloads. Access is used only for the project you choose.</string>
<key>NSNetworkVolumesUsageDescription</key><string>UXQA reads a project on a network volume only when you select that project.</string>
<key>NSRemovableVolumesUsageDescription</key><string>UXQA reads a project on removable media only when you select that project.</string>
<key>NSLocalNetworkUsageDescription</key><string>UXQA opens the preview URL you configure, including a development server on your local network.</string>
</dict></plist>`);
const iconset = join(output, 'UXQA.iconset');
await mkdir(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) run('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), join(root, 'assets/icon.png'), '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
}
run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'UXQA.icns')]);
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await clone(join(root, name), join(resources, name));
await clone(join(root, 'docs/local-data-and-permissions.md'), join(resources, 'LOCAL-DATA-AND-PERMISSIONS.md'));
run('/usr/bin/swiftc', ['scripts/desktop/UXQA.swift', '-o', join(bin, 'UXQA'), '-target', `${process.arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx14.0`, '-framework', 'AppKit', '-framework', 'WebKit']);
run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'local.uxqa.model-core', coreBinary]);
run('/usr/bin/codesign', ['--verify', '--strict', coreBinary]);
const sources = (await readdir(coreSource, { recursive: true })).filter((p) => /\.(go|mod|sum)$/.test(p)).sort();
const digest = createHash('sha256');
for (const path of sources) { digest.update(path); digest.update(await readFile(join(coreSource, path))); }
const upstream = JSON.parse(await readFile(join(coreSource, 'UPSTREAM-MANIFEST.json'), 'utf8'));
const info = { builtAt: new Date().toISOString(), platform: target, uxqa: pkg.version,
  node: { version: process.version, source: 'official Node runtime used by build host', sha256: await hash(node) },
  modelCore: { source: 'native/model-core/cmd/uxqa-core', sourceSha256: digest.digest('hex'), packagedSha256: await hash(coreBinary), license: 'MIT', integration: 'source-integrated UXQA module; private authenticated API; UXQA account store', upstream: upstream.revision },
  signing: 'local ad-hoc; not notarized', credentialsIncluded: false };
await writeFile(join(resources, 'BUILD-INFO.json'), JSON.stringify(info, null, 2) + '\n');
run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
await writeFile(join(output, '使用说明.md'), `# UXQA 本地应用\n\n双击 UXQA.app。可将应用移动到自己的 Applications 文件夹，无需终端或另装 Node。\n\n在设置 → AI 看图复核 → 模型与订阅账号中添加服务商或登录订阅，再获取模型、测试看图、保存。全部配置和账号管理在 UXQA 内完成；服务商授权在系统浏览器完成。开启复核后会向所选模型发送截图。\n\n数据保存在 ~/.uxqa，模型配置与登录凭据在 ~/.uxqa/model-core；包中不含任何账号或密钥。退出应用会关闭自己启动的模块。\n\n此包仅在 macOS Apple 芯片本地验证，使用本地临时签名，未经 Apple 公证。订阅是否可用取决于实际登录、套餐和供应商；Claude 订阅需要本机官方 Claude Code 运行时。\n\n协议与授权模块迁自 Magpie 的 MIT 源码，许可证与来源记录保留在应用资源中。此包不包含或启动 Magpie 应用。浏览器截图组件沿用 UXQA 的按需下载流程。\n`);
const zip = join(output, `UXQA-${pkg.version}-macOS-${process.arch}.zip`);
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
await writeFile(join(output, 'SHA256SUMS.txt'), `${await hash(zip)}  ${zip.split('/').pop()}\n`);
console.log(JSON.stringify({ app, zip, bytes: (await stat(zip)).size, modelCore: 'source-integrated' }));
