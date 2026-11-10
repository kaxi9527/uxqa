import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CheckResult } from './run.js';

export interface BaselineEntry { fingerprint: string; rule: string; file: string; line: number }
export interface Baseline { version: 1; createdAt: string; entries: BaselineEntry[] }

export async function readBaseline(path: string): Promise<Baseline | undefined> {
  try { await access(path); } catch { return undefined; }
  const raw = JSON.parse(await readFile(path, 'utf8')) as Baseline;
  if (raw?.version !== 1 || !Array.isArray(raw.entries)) throw new Error(`基线文件格式不对：${path}`);
  return raw;
}

/** Record current problems as known debt so only new ones fail. Ignored problems are not recorded. */
export async function writeBaseline(path: string, result: CheckResult): Promise<Baseline> {
  if (result.scope !== 'project') throw new Error('更新基线需要检查整个项目，不能只检查部分文件');
  const baseline: Baseline = {
    version: 1,
    createdAt: new Date().toISOString(),
    entries: result.violations.filter((violation) => violation.status !== 'ignored').map((violation) => ({ fingerprint: violation.fingerprint, rule: violation.rule, file: violation.file, line: violation.line })),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}
