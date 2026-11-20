import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildDiagnosis, type DiagnosisFocus, type DiagnosisTask } from '../guidance/diagnostics.js';
import { diagnosisContext } from '../guidance/context.js';
import { dataDir, type ProjectEntry, type Round } from './store.js';
import { readIssueWorkflow, roundForWorkflow, type IssueWorkflow } from './issue-workflow.js';
import { issueGuidance } from '../guidance/issues.js';
import { readAccessSettings } from './access.js';
import { assuranceCatalog } from '../guidance/assurance.js';
import { currentClauses } from './assurance.js';
import { listEvidence } from './evidence.js';

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
  return savePlan(entry, plan);
}

export async function createAssurancePlan(entry: ProjectEntry, round: Round, id: string) {
  const locale = (await readAccessSettings()).locale;
  const en = locale === 'en';
  const suite = assuranceCatalog(locale).find(item => item.id === id);
  if (!suite) return undefined;
  const clauses = (await currentClauses(entry)).filter(ref => ref.suites.includes(id));
  const sources=(await listEvidence(entry)).filter(item=>item.suites.includes(id));
  const findings = roundForWorkflow(round, await readIssueWorkflow(entry.id)).result.violations.filter(issue => issue.status === 'new' && issueGuidance(issue).suite === id).length;
  const tasks: DiagnosisTask[] = suite.checks.map(([name, procedure, decision], i) => ({
    id: suite.id + '-' + (i + 1), topic: name, domain: suite.domain as DiagnosisTask['domain'],
    check: name + ' · ' + procedure, fix: suite.boundary, verify: decision,
  }));
  const markdown = ['# ' + suite.title, en ? '## Scope and method' : '## 范围与方法', suite.inputs, suite.boundary,
    en ? '## Project sources' : '## 项目依据',
    ...(clauses.length ? clauses.map(ref => '- [' + (en ? { imported:'Verified against local snapshot', current:'File verified', stale:'Source changed or unavailable', reported:'User-supplied excerpt' } : { imported:'已核对本地导入快照', current:'文件原文已核对', stale:'文件已变更或不可访问', reported:'人工提供摘录' })[ref.status] + '] ' + ref.source + ' · ' + ref.locator + (ref.line ? ' · L' + ref.line : '') + ' — ' + ref.quote) : [en ? 'No project clause linked. Gather evidence before judging a project requirement.' : '尚未关联项目条款。涉及项目约定的结论待补充依据。']),
    ...sources.map(s=>'- '+s.name+' · '+s.format+' · '+(s.revision ? s.revision.slice(0,12) : en?'Link only':'仅关联链接')+' · '+(en?'Extracted passages: ':'已提取片段 ')+s.count),
    en ? '## Verification tasks' : '## 逐项验证', ...tasks.map(task => '- [ ] ' + task.check + '\n' + task.verify),
    en ? '## Method references' : '## 方法来源', ...suite.sources.map(url => '- ' + url)].join('\n');
  const plan = { id: randomUUID(), at: new Date().toISOString(), roundId: round.id, objective: suite.title, title: suite.title,
    focus: suite.id, language: en ? 'en' as const : 'zh' as const, knowledgeVersion: 'uxqa-assurance-1', findings, pendingChecks: tasks.length, tasks, markdown, clauses };
  return savePlan(entry, plan);
}

async function savePlan(entry: ProjectEntry, plan: SavedDiagnosis) {
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
