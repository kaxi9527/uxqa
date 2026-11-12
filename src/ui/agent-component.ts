import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { findProductRoot } from '../inventory/read.js';
import { prepareComponentPlan, syncComponentPlan, validateComponentPlan } from '../library/workflow.js';
import { boundPath } from '../library/paths.js';
import { dataDir, type ProjectEntry } from './store.js';

const ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const base = (projectId: string, id: string) => join(dataDir(), 'projects', projectId, 'component-plans', id);

function planPath(projectId: string, id: unknown): string {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('无效的组件计划');
  return join(base(projectId, id), 'plan', 'component-plan.json');
}

export async function agentComponentPlan(entry: ProjectEntry, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('组件定义必须是对象');
  const serialized = JSON.stringify(input);
  if (serialized.length > 200_000) throw new Error('组件定义超过大小限制');
  const root = await realpath(entry.root);
  if (await findProductRoot(root) !== root) throw new Error('所选目录不是工程根目录，未自动扩大检查范围；请在正确的项目根目录运行检查');
  const id = randomUUID(), directory = base(entry.id, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const definitionPath = join(directory, 'definition.json');
  await writeFile(definitionPath, serialized, { flag: 'wx', mode: 0o600 });
  const { plan } = await prepareComponentPlan({ source: root, definitionPath, outDir: join(directory, 'plan') });
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { packageManager?: string; scripts?: Record<string, string> };
  const manager = manifest.packageManager?.startsWith('pnpm@') ? 'pnpm' : 'npm';
  const names = [plan.definition.verification.testScript, plan.definition.verification.typecheckScript];
  const scenario = await readFile(await boundPath(root, plan.definition.verification.qaConfig), 'utf8');
  if (scenario.length > 200_000) throw new Error('浏览器检查配置超过大小限制');
  return {
    data: { status: 'planned' as const, planId: id, component: plan.definition.name, operation: plan.definition.operation ?? 'register', library: relative(root, plan.library.root) || '.', implementation: plan.definition.implementation, consumers: plan.definition.consumers, scripts: names, scenario: plan.definition.verification.qaConfig },
    privateData: { manager, scripts: names.map((name) => ({ name, command: manifest.scripts?.[name] ?? '' })), scenario, scenarioHash: createHash('sha256').update(scenario).digest('hex') },
  };
}

export async function validateAgentComponentPlan(entry: ProjectEntry, id: unknown) {
  const path = planPath(entry.id, id);
  const plan = await validateComponentPlan(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error('找不到组件计划');
    throw error;
  });
  if (plan.productRoot !== await realpath(entry.root)) throw new Error('组件计划不属于当前项目');
  return plan;
}

export async function syncAgentComponentPlan(entry: ProjectEntry, id: unknown, reviewedScenarioHash: string) {
  const plan = await validateAgentComponentPlan(entry, id);
  const scenario = await readFile(await boundPath(plan.productRoot, plan.definition.verification.qaConfig));
  if (createHash('sha256').update(scenario).digest('hex') !== reviewedScenarioHash) throw new Error('浏览器检查配置已变化，请重新准备并核对组件计划');
  const output = join(base(entry.id, id as string), `verification-${randomUUID()}`);
  const result = await syncComponentPlan(planPath(entry.id, id), output);
  return { status: result.status, planId: id as string, componentCatalog: relative(plan.productRoot, result.catalog), specification: relative(plan.productRoot, result.specification), evidence: output };
}
