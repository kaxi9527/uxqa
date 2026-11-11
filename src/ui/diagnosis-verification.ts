import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDiagnosis, type SavedDiagnosis } from './diagnosis.js';
import { dataDir } from './store.js';
import { readAccessSettings } from './access.js';

export const VERIFICATION_STATES = { pending: '待验证', passed: '记录通过', failed: '发现问题', 'not-applicable': '不适用' } as const;
const ENGLISH_STATES: Record<keyof typeof VERIFICATION_STATES, string> = { pending: 'Pending', passed: 'Recorded pass', failed: 'Issue found', 'not-applicable': 'Not applicable' };
type VerificationStatus = keyof typeof VERIFICATION_STATES;
export interface VerificationEvent { id: string; taskId: string; status: VerificationStatus; note: string; at: string; via: 'api' | 'mcp' }
export interface DiagnosisVerification { events: VerificationEvent[] }
export class VerificationError extends Error { constructor(public status: number, message: string) { super(message); } }
const directory = (projectId: string) => join(dataDir(), 'projects', projectId, 'diagnosis-verification');

async function load(projectId: string, planId: string) {
  const plan = await getDiagnosis(projectId, planId);
  if (!plan) throw new VerificationError(404, '找不到此项目中的修复方案');
  let verification: DiagnosisVerification;
  try { verification = JSON.parse(await readFile(join(directory(projectId), `${plan.id}.json`), 'utf8')) as DiagnosisVerification; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; verification = { events: [] }; }
  return { plan, verification };
}

function view(plan: SavedDiagnosis, verification: DiagnosisVerification, locale: 'zh' | 'en' | null) {
  const latest = new Map(verification.events.map((event) => [event.taskId, event]));
  const tasks = plan.tasks ?? [];
  const summary = { total: tasks.length, pending: 0, passed: 0, failed: 0, 'not-applicable': 0 };
  for (const task of tasks) summary[latest.get(task.id)?.status ?? 'pending']++;
  const states = locale === 'en' ? ENGLISH_STATES : VERIFICATION_STATES;
  const markdown = locale === 'en' ? [plan.markdown, '', '## Verification records (reported by the author, not automatic results)',
    !plan.tasks ? 'This legacy text-only plan has no structured tasks; generate a new plan to record verification.' : `Pending: ${summary.pending}; recorded passes: ${summary.passed}; issues found: ${summary.failed}; not applicable: ${summary['not-applicable']}.`,
    'The plan above remains in its saved language and represents the original snapshot. Results below reflect current records, not whole-product acceptance.',
    ...tasks.flatMap((task) => {
      const record = latest.get(task.id);
      return record ? [`### ${task.topic} · ${task.id}`, `Check: ${task.check}`, `Result: ${states[record.status]}; time: ${record.at}; via: ${record.via}`, `Evidence or reason (original): ${record.note}`, ''] : [];
    })].join('\n') : [plan.markdown, '', '## 验证记录（填写者提供，非自动检测结论）',
    !plan.tasks ? '旧版文字方案没有结构化任务；请重新生成方案后逐项记录。' : `待验证 ${summary.pending}；记录通过 ${summary.passed}；发现问题 ${summary.failed}；不适用 ${summary['not-applicable']}。`,
    '上方方案保留生成时的快照；以下为当前记录。状态与说明不替代实际证据，也不代表全产品验收通过。',
    ...tasks.flatMap((task) => {
      const record = latest.get(task.id);
      return record ? [`### ${task.topic} · ${task.id}`, `要求：${task.check}`, `结果：${VERIFICATION_STATES[record.status]}；时间：${record.at}；入口：${record.via}`, `证据或理由：${record.note}`, ''] : [];
    })].join('\n');
  return { plan, verification, summary, states, markdown };
}

export async function getDiagnosisVerification(projectId: string, planId: string) {
  const { plan, verification } = await load(projectId, planId);
  return view(plan, verification, (await readAccessSettings()).locale);
}

export async function recordDiagnosisVerification(projectId: string, planId: string, input: Record<string, unknown>, via: VerificationEvent['via']) {
  const { plan, verification } = await load(projectId, planId);
  if (!plan.tasks) throw new VerificationError(400, '此方案生成于旧版本，请重新生成后逐项验证');
  if (typeof input.taskId !== 'string' || !plan.tasks.some((task) => task.id === input.taskId)) throw new VerificationError(400, '请选择此方案中的验证任务');
  if (typeof input.status !== 'string' || !Object.hasOwn(VERIFICATION_STATES, input.status)) throw new VerificationError(400, '请选择有效的验证结果');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!note || note.length > 4000) throw new VerificationError(400, '请填写 1–4000 字的验证过程、观察证据或适用性理由');
  verification.events.push({ id: randomUUID(), taskId: input.taskId, status: input.status as VerificationStatus, note, at: new Date().toISOString(), via });
  await mkdir(directory(projectId), { recursive: true, mode: 0o700 });
  const path = join(directory(projectId), `${plan.id}.json`), temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(verification, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
  return view(plan, verification, (await readAccessSettings()).locale);
}
