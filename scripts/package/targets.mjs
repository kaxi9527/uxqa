// Shared facts for the download packages: which Node runtime, which platforms, where things go.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const RELEASE = join(ROOT, 'release');
// Git Bash's GNU tar interprets Windows drive letters as remote hosts and cannot
// extract zip archives. Use the Windows-provided bsdtar on that platform.
export const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

/** Official Node 22 LTS shipped inside every package. Change here only; fetch-node.mjs verifies against nodejs.org SHASUMS256.txt. */
export const NODE_VERSION = 'v22.23.4';
export const NODE_DIST = `https://nodejs.org/dist/${NODE_VERSION}`;
export const NODE_CACHE = process.env.UXQA_NODE_CACHE ?? join(homedir(), '.cache', 'uxqa', `node-${NODE_VERSION}`);

/**
 * id: package suffix; archive: the nodejs.org file; node: the binary inside it;
 * format: what the person downloads; playwrightHost: Playwright's platform name, to read the browser download size per target.
 */
export const TARGETS = {
  'darwin-arm64': { os: 'darwin', archive: `node-${NODE_VERSION}-darwin-arm64.tar.gz`, node: 'bin/node', format: 'zip', playwrightHost: 'mac15-arm64' },
  'darwin-x64': { os: 'darwin', archive: `node-${NODE_VERSION}-darwin-x64.tar.gz`, node: 'bin/node', format: 'zip', playwrightHost: 'mac15' },
  'win-x64': { os: 'win32', archive: `node-${NODE_VERSION}-win-x64.zip`, node: 'node.exe', format: 'zip', playwrightHost: 'win64' },
  'linux-x64': { os: 'linux', archive: `node-${NODE_VERSION}-linux-x64.tar.xz`, node: 'bin/node', format: 'tar.gz', playwrightHost: 'ubuntu24.04-x64' },
  'linux-arm64': { os: 'linux', archive: `node-${NODE_VERSION}-linux-arm64.tar.xz`, node: 'bin/node', format: 'tar.gz', playwrightHost: 'ubuntu24.04-arm64' },
};

export function hostTarget() {
  const os = process.platform === 'win32' ? 'win' : process.platform;
  return `${os}-${process.arch}`;
}

/** `--target a,b` or `--target all`; default all. */
export function pickTargets(argv) {
  const index = argv.indexOf('--target');
  const raw = index >= 0 ? argv[index + 1] : 'all';
  const ids = raw === 'all' ? Object.keys(TARGETS) : String(raw).split(',').map((id) => id.trim()).filter(Boolean);
  for (const id of ids) if (!TARGETS[id]) throw new Error(`不认识的平台 ${id}；可选：${Object.keys(TARGETS).join('、')}、all`);
  return ids;
}

export function mib(bytes) {
  return bytes ? `${(bytes / 1048576).toFixed(1)} MiB` : '大小未知';
}
