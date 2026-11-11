import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Violation } from '../check/run.js';
import type { IssueDomain } from '../guidance/types.js';
import { dataDir, type Round } from './store.js';

export const ISSUE_STATES = { open: '待处理', working: '处理中', recheck: '待复检', accepted: '接受偏差', confirmed: '人工确认' } as const;
export type IssueState = keyof typeof ISSUE_STATES;
export interface IssueDisposition { state: IssueState; domain?: IssueDomain; note: string; updatedAt: string; roundId: string }
export interface IssueWorkflow { dispositions: Record<string, IssueDisposition>; observations: Violation[] }

export function roundForWorkflow(round: Round, workflow: IssueWorkflow): Round {
  return { ...round, result: { ...round.result, violations: [...round.result.violations, ...workflow.observations].map((issue) => ({ ...issue, ...(workflow.dispositions[issue.fingerprint]?.domain ? { domain: workflow.dispositions[issue.fingerprint].domain } : {}) })) } };
}

const pathFor = (projectId: string) => join(dataDir(), 'projects', projectId, 'issue-workflow.json');

export async function readIssueWorkflow(projectId: string): Promise<IssueWorkflow> {
  try { return JSON.parse(await readFile(pathFor(projectId), 'utf8')) as IssueWorkflow; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { dispositions: {}, observations: [] }; throw error; }
}

async function save(projectId: string, data: IssueWorkflow): Promise<void> {
  const path = pathFor(projectId);
  await mkdir(join(dataDir(), 'projects', projectId), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}

export async function setIssueDisposition(projectId: string, fingerprint: string, input: Omit<IssueDisposition, 'updatedAt'>): Promise<IssueWorkflow> {
  const workflow = await readIssueWorkflow(projectId);
  workflow.dispositions[fingerprint] = { ...input, updatedAt: new Date().toISOString() };
  await save(projectId, workflow);
  return workflow;
}

export async function addObservation(projectId: string, input: { name: string; detail: string; location: string; domain: IssueDomain; fix: string }): Promise<IssueWorkflow> {
  const workflow = await readIssueWorkflow(projectId);
  workflow.observations.push({ name: input.name, title: '人工记录', what: input.detail, consequence: '这是人工观察记录，需要按描述重现并验证。',
    fix: input.fix || '先按记录的操作重现，再根据项目规范修复并复检。', rule: 'manual/observation', origin: 'manual', domain: input.domain,
    level: 'reference', file: input.location, line: 0, column: 0, snippet: '', detail: input.detail, status: 'new', fingerprint: `manual-${randomUUID()}` });
  await save(projectId, workflow);
  return workflow;
}

export function recheckComparison(previous: Round | undefined, current: Round) {
  if (!previous) return { previous: null, current: current.id, items: [] };
  const currentById = new Map(current.result.violations.map((issue) => [issue.fingerprint, issue]));
  const items = previous.result.violations.filter((issue) => issue.status === 'new').map((issue) => {
    const found = currentById.get(issue.fingerprint);
    // Absence is not proof of repair: source/rule/route coverage can change between rounds.
    return { fingerprint: issue.fingerprint, name: issue.name, file: issue.file,
      status: found?.status === 'new' ? 'present' : found ? 'excluded' : 'not-observed',
      explanation: found?.status === 'new' ? '本轮仍然检出' : found ? '已进入基线或忽略项，不代表修复' : current.partial ? '本轮覆盖不完整，尚不能确认修复' : '本轮未再检出；请结合相同规则、页面状态与证据确认',
    };
  });
  return { previous: previous.id, current: current.id, items };
}
