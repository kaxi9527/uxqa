import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { GitState } from './types.js';

const exec = promisify(execFile);

function packageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth++, dir = dirname(dir)) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (manifest.name === 'uxqa-harness' && manifest.version) return manifest.version;
    } catch { /* keep walking up from src/ or dist/src/ */ }
  }
  return 'unknown';
}

export const UXQA_VERSION = packageVersion();

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', root, ...args], { timeout: 5000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

/** Read-only revision snapshot of the product under test; never changes the product checkout. */
export async function readGitState(root: string): Promise<GitState> {
  try {
    const revision = await git(root, ['rev-parse', 'HEAD']);
    const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined);
    const status = await git(root, ['status', '--porcelain=v1', '--untracked-files=normal']);
    const changed = status ? status.split('\n').filter(Boolean) : [];
    return { revision, ...(branch ? { branch } : {}), dirty: changed.length > 0, changedFiles: changed.length, changed: changed.slice(0, 50) };
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { error: `git state unavailable: ${message}` };
  }
}
