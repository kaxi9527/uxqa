import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { assuranceCatalog } from '../guidance/assurance.js';
import { comparePngs } from '../visual/compare.js';
import { loadConfig } from '../config.js';
import { INTERACTION_SCENARIOS } from '../types.js';
import { runAudit } from '../runner.js';
import { measureAgentMotion } from './agent-motion.js';
import { checkedPath, ProjectAgentError } from './project-agent.js';
import { dataDir, shotsDir, type ProjectEntry, type Round } from './store.js';
import { evidenceImage, readEvidence } from './evidence.js';
import {readInventory} from '../inventory/read.js';

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const folder = (entry: ProjectEntry, kind: string) => join(dataDir(), 'projects', entry.id, 'assurance', kind);
export interface SourceClause {
  purpose?: 'requirement' | 'observation';
  id: string; source: string; locator: string; quote: string; suites: string[]; path?: string; digest?: string; line?: number; evidenceId?: string;
}
export async function readRecords<T>(entry: ProjectEntry, kind: 'clauses' | 'comparisons' | 'samples' | 'sessions'): Promise<T[]> {
  const dir = folder(entry, kind);
  const files = await readdir(dir).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  return Promise.all(files.filter(file => file.endsWith('.json')).sort().map(async file => JSON.parse(await readFile(join(dir, file), 'utf8')) as T));
}

const sampling = new Set<string>();
export const isSampling = (entry: ProjectEntry) => sampling.has(entry.id);
const sampleChecks: Record<string, string[]> = {
  accessibility: ['axe','axe-manual-review','keyboard-focus','reflow-320','zoom-200','reduced-motion','screen-reader','tab-order-logic'],
  interaction: ['keyboard-focus','tab-order-logic', ...INTERACTION_SCENARIOS],
  compatibility: ['reflow-320','zoom-200','real-device'],
};
export async function samplePage(entry: ProjectEntry, round: Round, input: Record<string, unknown>) {
  const suite = String(input.suite), route = field(input.route, 2000);
  if (!entry.pages || !route || new URL(route, entry.pages.baseUrl).origin !== new URL(entry.pages.baseUrl).origin || (!Object.hasOwn(sampleChecks, suite) && suite !== 'performance')) throw new ProjectAgentError(400, '请核对检测类别和项目预览路径。 / Check the category and project preview route.');
  if (sampling.has(entry.id)) throw new ProjectAgentError(409, '项目页面正在采样。 / A page sample is already running.');
  const id = randomUUID(), at = new Date().toISOString();
  const base = { id, at, roundId: round.id, suite, route, origin: entry.pages.baseUrl };
  sampling.add(entry.id);
  try {
    if (suite === 'performance') {
      const sample = await measureAgentMotion(entry, { route, selector:input.selector ?? 'body', trigger:input.trigger ?? 'idle', reducedMotion:input.reducedMotion }, new AbortController().signal);
      return await saveRecord(entry, 'samples', { ...base, sample });
    }
    const selected = sampleChecks[suite];
    const scenario = suite === 'interaction' && input.scenario ? Object.fromEntries(Object.entries(input.scenario).filter(([key])=>
      ['type','setup','request','error','ready','retry','save','saved','continuation','switcher','option','lang','entry'].includes(key))) : undefined;
    const config = loadConfig({ name: suite, baseUrl: entry.pages.baseUrl, routes: [route], storageState: entry.pages.storageState,
      scenarios: scenario ? [{...scenario, route}] : [],
      viewports: [{name:'desktop',width:1440,height:900},{name:'narrow',width:390,height:844}],
      options: { axe: suite === 'accessibility', keyboard: selected.includes('keyboard-focus'), reflow: selected.includes('reflow-320'), reducedMotion: selected.includes('reduced-motion'), trace:'on-failure', screenshots:false } });
    const result = await runAudit(config, { outDir: join(folder(entry,'sample-evidence'),id) });
    const checks = result.checks.filter(c => selected.includes(c.check) || c.check === 'page-load');
    return await saveRecord(entry, 'samples', { ...base, ...(scenario ? {scenario}:{}), checks, findings: result.findings, coverage: result.coverage, browser:result.evidence?.browser });
  } catch (e) {
    return await saveRecord(entry, 'samples', { ...base, status:'blocked', reason: e instanceof Error ? e.message : String(e) });
  } finally { sampling.delete(entry.id); }
}
async function saveRecord<T extends { id: string }>(entry: ProjectEntry, kind: string, record: T) {
  const dir = folder(entry, kind);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, record.id + '.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  return record;
}
const known = new Set(assuranceCatalog(null).map(s => s.id));
function field(input: unknown, max: number) {
  return typeof input === 'string' && input.trim().length <= max ? input.trim() : '';
}
export async function addUsabilitySession(entry: ProjectEntry, round: Round, input: Record<string, unknown>) {
  const task = field(input.task,300), cohort = field(input.cohort,300), evidence = field(input.evidence,2000);
  const outcome = String(input.outcome), friction = String(input.friction);
  if (!task || !cohort || !evidence || !['independent','assisted','abandoned'].includes(outcome) || !['none','discovery','language','effort','recovery'].includes(friction)) {
    throw new ProjectAgentError(400, '请记录任务、用户与设备条件、观察过程及实际结果。 / Record the task, participant and device conditions, observation and outcome.');
  }
  const seconds = input.seconds;
  const ease=input.reportedEase;
  if(ease!==undefined && (typeof ease!=='number' || !Number.isInteger(ease) || ease<1 || ease>7))throw new ProjectAgentError(400,'请记录参与者选择的 1–7 分 / Record the participant’s own 1–7 rating.');
  if (seconds !== undefined && (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0)) throw new ProjectAgentError(400, '耗时须为实际测得的正数。 / Enter a positive observed duration.');
  return saveRecord(entry,'sessions',{ id:randomUUID(), at:new Date().toISOString(), roundId:round.id, task, cohort, evidence, outcome, friction, seconds, reportedEase:ease });
}
async function documentText(entry: ProjectEntry, path: unknown) {
  const target = await checkedPath(entry.root, path);
  if (target.directory || (await stat(target.path)).size > 4_000_000) throw new ProjectAgentError(400, '请选择小于 4 MB 的文本文件。 / Select a text file under 4 MB.');
  const bytes = await readFile(target.path);
  try {
    if (bytes.includes(0)) throw new Error();
    return { target, digest: hash(bytes), text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\r\n', '\n') };
  } catch { throw new ProjectAgentError(400, '此文件需要手动摘录，请填写页码或节点。 / For this format, enter an excerpt and its page or node.'); }
}
const signals: Record<string, RegExp> = {
  fidelity: /字号|设计稿|栅格|字重|间距|颜色|对齐|font|spacing|design frame|alignment|colour|color/i,
  logic: /条件|规则|状态|生效|权限|角色|接口|阈值|必须|确认后|取消|边界|\b(?:if|when|must|role|api|boundary|limit|threshold)\b/i,
  interaction: /点击|焦点|弹层|滚动|手势|返回|拖拽|输入|click|focus|scroll|gesture|drag|navigate/i,
  usability: /用户|便利|认知|用户反馈|求助|任务耗时|易用|user research|usability|confus|help|task completion/i,
  accessibility: /无障碍|读屏|对比度|焦点|键盘|辅助技术|wcag|contrast|keyboard|screen reader|aria-/i,
  components: /组件|变体|令牌|token|component|story|props|variant/i,
  compatibility: /离线|重试|语言|国际化|窄屏|兼容|横屏|浏览器|offline|retry|locale|rtl|browser|viewport/i,
  performance: /性能|延迟|长任务|毫秒|帧率|动效|动画|latency|performance|motion|duration|long task|\b(?:lcp|cls|inp|ms)\b/i,
};
export async function inspectDocument(entry: ProjectEntry, input: Record<string, unknown>) {
  if (input.evidenceId) {
    const doc=await readEvidence(entry,input.evidenceId);
    const offset=Number.isInteger(input.offset) ? Math.max(0,Number(input.offset)) : 0;
    const query=String(input.query ?? '').trim().toLowerCase();
    const rows=doc.passages.map((p,index)=>({index,...p})).filter(p=>(p.locator+' '+p.text).toLowerCase().includes(query));
    return {candidates:rows.slice(offset,offset+25).map(p=>({index:p.index,locator:p.locator,quote:p.text,suites:Object.entries(signals).filter(([,re])=>re.test(p.text)).map(([key])=>key)})),next:offset+25<rows.length?offset+25:null};
  }
  const { target, text } = await documentText(entry, input.path);
  const offset = typeof input.offset === 'number' && Number.isInteger(input.offset) ? Math.max(0, input.offset) : 0;
  const lines = text.split('\n');
  const candidates = [];
  let index = offset;
  while (index < lines.length && candidates.length < 25) {
    const line = ++index, quote = lines[line - 1].trim();
    if (!quote || quote.length > 4000) continue;
    candidates.push({ line, quote, suites: Object.entries(signals).filter(([, re]) => re.test(quote)).map(([key]) => key) });
  }
  return { path: target.name, candidates, next: index < lines.length ? index : null };
}
export async function removeClause(entry: ProjectEntry, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ProjectAgentError(400, 'Invalid reference ID');
  await unlink(join(folder(entry, 'clauses'), id + '.json')).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
}
export async function addClause(entry: ProjectEntry, input: Record<string, unknown>) {
  const source = field(input.source, 500), locator = field(input.locator, 500), quote = field(input.quote, 4000);
  if (!source || !locator || !quote || !Array.isArray(input.suites) || !input.suites.length || !input.suites.every(id => typeof id === 'string' && known.has(id))) {
    throw new ProjectAgentError(400, '请填写来源、版本或章节和原文，并选至少一种检测。 / Add a source, revision or section, excerpt and at least one check.');
  }
  const clause: SourceClause = { id: randomUUID(), source, locator, quote, suites: [...new Set(input.suites as string[])] };
  if(input.purpose!==undefined && input.purpose!=='requirement' && input.purpose!=='observation')throw new ProjectAgentError(400,'无效的条款用途 / Invalid clause purpose');
  clause.purpose=input.purpose ?? 'requirement';
  if (input.evidenceId) {
    const doc=await readEvidence(entry,input.evidenceId);
    if(input.purpose===undefined && (doc.kind==='repository' || doc.format==='URL'))clause.purpose='observation';
    const passage=doc.passages[Number(input.index)];
    if (!Number.isInteger(input.index) || !passage || !passage.text.includes(quote)) throw new ProjectAgentError(400,'摘录与导入原文不符。 / Excerpt does not match the imported passage.');
    Object.assign(clause,{source:doc.name,locator:passage.locator,digest:doc.revision,evidenceId:doc.id});
  } else if (input.verifyFile === true) {
    const { target, digest, text } = await documentText(entry, source);
    const at = text.indexOf(quote);
    if (at < 0 || text.indexOf(quote, at + 1) >= 0) throw new ProjectAgentError(400, '原文缺失或重复，请选择一段唯一原文。 / Provide one unique, exact excerpt from the text file.');
    Object.assign(clause, { path: target.name, digest, line: text.slice(0, at).split('\n').length });
  }
  return saveRecord(entry, 'clauses', clause);
}
export async function currentClauses(entry: ProjectEntry) {
  const records = await readRecords<SourceClause>(entry, 'clauses');
  const revisions = new Map<string, Promise<string | undefined>>();
  return Promise.all(records.map(async record => {
    if (record.evidenceId) return {...record,status:'imported' as const};
    if (!record.path) return { ...record, status: 'reported' as const };
    if (!revisions.has(record.path)) revisions.set(record.path, checkedPath(entry.root, record.path).then(async target =>
      !target.directory && (await stat(target.path)).size <= 4_000_000 ? hash(await readFile(target.path)) : undefined).catch(() => undefined));
    const current = await revisions.get(record.path);
    return { ...record, status: current === record.digest ? 'current' as const : 'stale' as const };
  }));
}
export async function compareDesign(entry: ProjectEntry, round: Round, input: Record<string, unknown>) {
  const view = round.capture?.views?.find(v => basename(v.image) === input.view);
  const locator = field(input.locator, 500);
  if (!view || !locator || input.aligned !== true) throw new ProjectAgentError(400, '请选择实测截图、填写设计版本或帧，并确认比较条件。 / Select a capture, identify the design revision or frame and confirm matching conditions.');
  let design:Buffer, reference:string;
  const evidenceId = typeof input.evidenceId==='string' ? input.evidenceId : undefined;
  if (evidenceId) {
    const frame=await evidenceImage(entry,evidenceId); design=frame.bytes; reference=frame.item.name;
  } else {
    const ref=await checkedPath(entry.root,input.path);
    if (!ref.name.toLowerCase().endsWith('.png') || ref.directory || (await stat(ref.path)).size > 32_000_000) throw new ProjectAgentError(400,'请选择项目内小于 32 MB 的 PNG 设计稿。 / Choose a project PNG under 32 MB.');
    reference=ref.name; design=await readFile(ref.path);
  }
  const actual = await readFile(join(shotsDir(entry.id, round.id), basename(view.image))).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return undefined; throw e; });
  if (!actual) return { status: 'missing' };
  const dimensions = (image: Buffer) => image.length > 32 && image.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ? [image.readUInt32BE(16), image.readUInt32BE(20)] : [];
  const expected = dimensions(design), observed = dimensions(actual);
  if (expected.length !== 2 || observed.length !== 2 || !expected[0] || !expected[1] || expected[0] * expected[1] > 16_000_000) throw new ProjectAgentError(400, 'PNG 无效或画布过大。 / Invalid PNG or canvas exceeds 16 megapixels.');
  const base = { id: randomUUID(), at: new Date().toISOString(), roundId: round.id, reference, evidenceId, locator, route: view.route, viewportWidth: view.width, capture: basename(view.image), expected, observed, referenceDigest: hash(design), captureDigest: hash(actual) };
  if (expected[0] !== observed[0] || expected[1] !== observed[1]) return saveRecord(entry, 'comparisons', { ...base, status: 'unaligned' });
  let region:{x:number;y:number;width:number;height:number}|undefined;
  if(input.region){
    const box=input.region as Record<string,number>;
    if(![box.x,box.y,box.width,box.height].every(Number.isInteger)||box.x<0||box.y<0||box.width<1||box.height<1||box.x+box.width>expected[0]||box.y+box.height>expected[1])throw new ProjectAgentError(400,'区域超出画面 / Region is outside the frame');
    region={x:box.x,y:box.y,width:box.width,height:box.height};
  }
  const center=region && {x:region.x+region.width/2,y:region.y+region.height/2};
  const matched=center && view.regions?.filter(r=>center.x>=r.x&&center.x<r.x+r.width&&center.y>=r.y&&center.y<r.y+r.height).sort((a,b)=>a.width*a.height-b.width*b.height)[0];
  const component=matched?.name || field(input.component,150);
  const impacted=component?[...new Set(round.capture?.views?.filter(v=>v.regions?.some(r=>r.name===component)).map(v=>v.route))]:[];
  const implementations=component?(await readInventory(entry.root)).components.filter(c=>c.name===component).map(c=>c.file):[];
  const result = await comparePngs(design, actual,region);
  const diff = result.changed ? 'change-' + base.id.replaceAll('-', '').slice(0,10) + '.png' : undefined;
  if (diff) await writeFile(join(shotsDir(entry.id, round.id), diff), Buffer.from(result.diff.split(',')[1], 'base64'), { flag: 'wx', mode: 0o600 });
  return saveRecord(entry, 'comparisons', { ...base, region,component,implementations,mapping:matched?'runtime':component?'manual':undefined,
    state:field(input.state,100)||view.state,impacted,status: result.changed ? 'review' : 'matched', changedPixels: result.changed, totalPixels: region?region.width*region.height:expected[0]*expected[1], channelTolerance: 24, diff });
}

export async function designImage(entry: ProjectEntry, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ProjectAgentError(404,'Unknown comparison');
  const file = join(folder(entry,'comparisons'),id + '.json');
  const record = await readFile(file,'utf8').then(data => JSON.parse(data) as { reference: string; referenceDigest: string; evidenceId?:string }).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') throw new ProjectAgentError(404,'Unknown comparison'); throw e; });
  if (record.evidenceId) return (await evidenceImage(entry,record.evidenceId)).bytes;
  const ref = await checkedPath(entry.root,record.reference);
  if (ref.directory || (await stat(ref.path)).size > 32_000_000) throw new ProjectAgentError(409,'Design frame changed');
  const bytes = await readFile(ref.path);
  if (hash(bytes) !== record.referenceDigest) throw new ProjectAgentError(409,'Design frame changed');
  return bytes;
}
