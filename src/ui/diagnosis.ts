import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildDiagnosis, type DiagnosisFocus, type DiagnosisTask } from '../guidance/diagnostics.js';
import { diagnosisContext } from '../guidance/context.js';
import { dataDir, type ProjectEntry, type Round } from './store.js';
import { roundForWorkflow, type IssueWorkflow } from './issue-workflow.js';
import { readAccessSettings } from './access.js';

export type SavedDiagnosis = Omit<ReturnType<typeof buildDiagnosis>, 'tasks'> & { tasks?: DiagnosisTask[]; id: string; at: string; roundId: string; objective: string };
const directory = (projectId: string) => join(dataDir(), 'projects', projectId, 'diagnoses');

export async function getDiagnosis(projectId: string, id: string): Promise<SavedDiagnosis | undefined> {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) return undefined;
  try { return JSON.parse(await readFile(join(directory(projectId), `${id}.json`), 'utf8')) as SavedDiagnosis; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

export async function createDiagnosis(entry: ProjectEntry, round: Round, workflow: IssueWorkflow, focus: DiagnosisFocus, objective: string): Promise<SavedDiagnosis> {
  const locale = (await readAccessSettings()).locale;
  const result = buildDiagnosis(roundForWorkflow(round, workflow), entry.name, workflow, focus, objective, await diagnosisContext(entry.root, locale), locale);
  const plan = { ...result, id: randomUUID(), at: new Date().toISOString(), roundId: round.id, objective };
  await mkdir(directory(entry.id), { recursive: true, mode: 0o700 });
  await writeFile(join(directory(entry.id), `${plan.id}.json`), JSON.stringify(plan, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return plan;
}

export async function listDiagnoses(projectId: string): Promise<SavedDiagnosis[]> {
  let files: string[];
  try { files = await readdir(directory(projectId)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const plans = await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => JSON.parse(await readFile(join(directory(projectId), file), 'utf8')) as SavedDiagnosis));
  return plans.sort((a, b) => b.at.localeCompare(a.at));
}
