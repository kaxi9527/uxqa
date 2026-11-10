import type { AiRoundInfo } from '../ai/review.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { CheckResult } from '../check/run.js';
import type { CaptureReport } from '../capture/pages.js';

/** Local console data lives outside every product: projects the user added and the history of check rounds. */
export function dataDir(): string {
  return process.env.UXQA_HOME ?? join(homedir(), '.uxqa');
}

export interface PageSettings { baseUrl: string; routes: string[]; storageState?: string; discover: boolean }

export interface ProjectEntry { id: string; name: string; root: string; addedAt: string; pages?: PageSettings }

export interface RoundSummary {
  id: string;
  number: number;
  at: string;
  newMust: number;
  newDefault: number;
  newReference: number;
  baseline: number;
  ignored: number;
  filesScanned: number;
  durationMs: number;
  /** Compared with the previous round: problems that appeared and problems that went away. */
  appeared: number;
  resolved: number;
  screenshots: number;
}

export interface Round extends RoundSummary {
  result: CheckResult;
  capture?: CaptureReport;
  /** Screenshot review by a vision model or the user's AI agent, if one ran. */
  ai?: AiRoundInfo;
  /** Source check finished but the page screenshots were cancelled or failed. */
  partial?: string;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function projectId(root: string): string {
  return createHash('sha256').update(root).digest('hex').slice(0, 12);
}

export async function listProjects(): Promise<ProjectEntry[]> {
  return readJson<ProjectEntry[]>(join(dataDir(), 'projects.json'), []);
}

export async function addProject(root: string, name?: string): Promise<ProjectEntry> {
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const projects = await listProjects();
  const existing = projects.find((project) => project.root === root);
  if (existing) return existing;
  const entry: ProjectEntry = { id: projectId(root), name: name ?? basename(root), root, addedAt: new Date().toISOString() };
  await writeJsonAtomic(join(dataDir(), 'projects.json'), [...projects, entry]);
  return entry;
}

export async function updateProject(id: string, change: Partial<Pick<ProjectEntry, 'name' | 'pages'>>): Promise<ProjectEntry> {
  const projects = await listProjects();
  const index = projects.findIndex((project) => project.id === id);
  if (index < 0) throw new Error('找不到这个项目');
  projects[index] = { ...projects[index], ...change };
  await writeJsonAtomic(join(dataDir(), 'projects.json'), projects);
  return projects[index];
}

export async function removeProject(id: string): Promise<void> {
  const projects = await listProjects();
  await writeJsonAtomic(join(dataDir(), 'projects.json'), projects.filter((project) => project.id !== id));
}

function roundsDir(id: string): string {
  return join(dataDir(), 'rounds', id);
}

export function newRoundId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Screenshots of one round live next to its record. */
export function shotsDir(id: string, roundId: string): string {
  return join(roundsDir(id), `${roundId}-shots`);
}

export async function listRounds(id: string): Promise<RoundSummary[]> {
  const files = (await readdir(roundsDir(id)).catch(() => [] as string[])).filter((file) => file.endsWith('.json')).sort();
  const rounds: RoundSummary[] = [];
  for (const file of files) {
    const round = await readJson<Round | undefined>(join(roundsDir(id), file), undefined);
    if (!round) continue;
    const { result: _result, capture: _capture, partial: _partial, ...summary } = round;
    void _result; void _capture; void _partial;
    rounds.push({ ...summary, screenshots: summary.screenshots ?? 0 });
  }
  return rounds.reverse();
}

/** Rewrites a stored round (after a screenshot review added notes and findings). */
export async function updateRound(id: string, round: Round): Promise<void> {
  if (!/^[\w-]+$/.test(round.id)) throw new Error('bad round id');
  await writeJsonAtomic(join(roundsDir(id), `${round.id}.json`), round);
}

export async function getRound(id: string, roundId: string): Promise<Round | undefined> {
  if (!/^[\w-]+$/.test(roundId)) return undefined;
  return readJson<Round | undefined>(join(roundsDir(id), `${roundId}.json`), undefined);
}

const ACTIVE = (result: CheckResult) => new Set(result.violations.filter((violation) => violation.status === 'new').map((violation) => violation.fingerprint));

export async function saveRound(id: string, result: CheckResult, extra: { roundId?: string; capture?: CaptureReport; partial?: string } = {}): Promise<Round> {
  await mkdir(roundsDir(id), { recursive: true, mode: 0o700 });
  const previousSummary = (await listRounds(id))[0];
  const previous = previousSummary ? await getRound(id, previousSummary.id) : undefined;
  const now = ACTIVE(result);
  const before = previous ? ACTIVE(previous.result) : new Set<string>();
  const roundId = extra.roundId ?? newRoundId();
  const at = new Date().toISOString();
  const round: Round = {
    id: roundId,
    number: (previousSummary?.number ?? 0) + 1,
    at,
    newMust: result.summary.newMust,
    newDefault: result.summary.newDefault,
    newReference: result.summary.newReference,
    baseline: result.summary.baseline,
    ignored: result.summary.ignored,
    filesScanned: result.filesScanned,
    durationMs: result.durationMs,
    appeared: previous ? [...now].filter((fingerprint) => !before.has(fingerprint)).length : now.size,
    resolved: previous ? [...before].filter((fingerprint) => !now.has(fingerprint)).length : 0,
    screenshots: Object.values(extra.capture?.captures ?? {}).filter((capture) => capture.shots.length).length,
    result,
    ...(extra.capture ? { capture: extra.capture } : {}),
    ...(extra.partial ? { partial: extra.partial } : {}),
  };
  await writeJsonAtomic(join(roundsDir(id), `${round.id}.json`), round);
  return round;
}
