import { randomUUID } from 'node:crypto';
import {taskAction,taskCatalog,taskWorkspace} from './acceptance-tasks.js';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assuranceCatalog } from '../guidance/assurance.js';
import { issueGuidance } from '../guidance/issues.js';
import { readRecords, samplePage } from './assurance.js';
import { getProjectAgent, ProjectAgentError } from './project-agent.js';
import { dataDir, getRound, listRounds, type ProjectEntry, type Round } from './store.js';

type Mode = 'manual' | 'auto';
interface Step { id:string; kind:'test'|'repair'; scope:string; name:string; from?:string; route?:string }
interface Evidence { outcome:'observed'|'findings'|'limited'|'manual'; zh:string; en:string; ref:string; roundId?:string }
interface Execution extends Step { enteredAt?:string; result?:Evidence; hold?:string }
interface Run { id:string; at:string; mode:Mode; status:'active'|'done'|'stopped'; index:number; steps:Execution[] }
interface Board { revision:number; mode:Mode; steps:Step[]; runs:Run[] }
type Check = (entry:ProjectEntry,sourceOnly:boolean)=>Promise<Round>;
const english=assuranceCatalog('en');
const catalog=assuranceCatalog('zh').map((s,i)=>({id:s.id,zh:s.title,en:english[i].title}));
const scopes=new Set(['full',...catalog.map(s=>s.id)]);
const browserScopes=new Set(['interaction','accessibility','compatibility','performance']);
const workers=new Set<string>();
const file=(entry:ProjectEntry)=>join(dataDir(),'projects',entry.id,'workflow-board.json');
const reject=(code:number,message:string):never=>{throw new ProjectAgentError(code,message);};

function read(entry:ProjectEntry):Board {
  try {return JSON.parse(readFileSync(file(entry),'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return {revision:0,mode:'manual',steps:[],runs:[]};}
}
// The revision check and atomic replacement happen in one event-loop turn. Slow checks run outside it.
function save(entry:ProjectEntry,board:Board){
  const path=file(entry),tmp=path+'.tmp';
  mkdirSync(dirname(path),{recursive:true});
  board.revision++;
  writeFileSync(tmp,JSON.stringify(board),{mode:0o600});renameSync(tmp,path);
}
export function boardView(entry:ProjectEntry){
  const saved=taskCatalog(entry).map(task=>({id:'task-'+task.id,zh:task.title,en:task.title}));
  return {...read(entry),catalog:[...catalog,...saved],busy:workers.has(entry.id)};
}
function parseSteps(value:unknown,entry:ProjectEntry):Step[]{
  const choices=new Set([...scopes,...taskCatalog(entry).map(t=>'task-'+t.id)]);
  if(!Array.isArray(value) || value.length>64)return reject(400,'每个流程最多 64 列 / A workflow supports up to 64 steps');
  const ids=new Set<string>();
  return value.map(s=>{
    if(!s || typeof s.id!=='string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id) || ids.has(s.id) ||
        !['repair','test'].includes(s.kind) || !choices.has(s.scope) || typeof s.name!=='string' || s.name.length>100)
      return reject(400,'步骤设置无效 / Invalid step settings');
    if(s.from!==undefined && (s.kind!=='repair' || typeof s.from!=='string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.from)))return reject(400,'修复依据无效 / Invalid repair input');
    if(s.route!==undefined && (s.kind!=='test' || !browserScopes.has(s.scope) || typeof s.route!=='string' || !s.route.trim() || s.route.length>2000))return reject(400,'采样路径无效 / Invalid sample route');
    ids.add(s.id);return {id:s.id,kind:s.kind,scope:s.scope,name:s.name.trim(),...(s.from?{from:s.from}:{}),...(s.route?{route:s.route.trim()}:{})};
  });
}
function advance(run:Run){
  run.index++;
  if(run.index===run.steps.length)run.status='done';
  else run.steps[run.index].enteredAt=new Date().toISOString();
}
function automatic(step:Step){
  return step.kind==='test' && (step.scope.startsWith('task-') || step.scope==='full' || step.scope==='components' || browserScopes.has(step.scope));
}

async function execute(entry:ProjectEntry,step:Step,check:Check):Promise<Evidence>{
  if(step.scope.startsWith('task-')){
    const id=step.scope.slice(5),state=await taskAction(entry,{op:'run',id});
    const attempt=state.tasks.find(t=>t.id===id)!.attempts.at(-1)!;
    return {ref:attempt.id,roundId:attempt.roundId,outcome:attempt.status==='pass'?'observed':attempt.status==='fail'?'findings':'limited',zh:'场景 · '+attempt.status,en:'Scenario · '+attempt.status};
  }
  if(step.scope==='full' || step.scope==='components'){
    const components=step.scope==='components',round=await check(entry,components);
    const findings=round.result.violations.filter(v=>v.status==='new' && (!components || issueGuidance(v).suite==='components'));
    const inventory=round.result.library;
    const captureGaps=round.capture?.pages.some(p=>p.status!=='ok') || round.capture?.views?.some(v=>!v.image);
    const mappingGap=components && (!inventory.components || inventory.source==='none');
    const limited=!!round.partial || !!captureGaps || !round.filesScanned || mappingGap;
    const enInfo=components?` · ${inventory.components} components / ${inventory.tokens} tokens`:round.capture?' · source and preview':' · source only';
    const zhInfo=components?` · ${inventory.components} 个组件 / ${inventory.tokens} 个设计变量`:round.capture?' · 源码和预览':' · 仅源码';
    const gap=round.partial || (captureGaps?'预览采集不完整 / Preview coverage incomplete':!round.filesScanned?'没有扫描到源文件 / No source files scanned':mappingGap?'未识别到可映射组件 / No mappable components identified':'');
    const paths=new Map<string,number>();
    if(components)for(const v of findings){
      const directory=v.file.replaceAll('\\','/').split('/').slice(0,-1).slice(0,2).join('/') || '.';
      paths.set(directory,(paths.get(directory)??0)+1);
    }
    const grouped=[...paths].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    const sources=grouped.slice(0,4).map(([path,count])=>path+' ('+count+')').join(', ');
    const remaining=grouped.slice(4).reduce((sum,[,count])=>sum+count,0);
    const examples=findings.slice(0,3).map(v=>v.file+':'+v.line+' '+v.what).join('\n').slice(0,750);
    const details=examples?'\n'+examples:'';
    return {outcome:limited?'limited':findings.length?'findings':'observed',ref:round.id,roundId:round.id,
      zh:`第 ${round.number} 轮 · ${round.filesScanned} 个文件 · ${findings.length} 个新发现${zhInfo}${gap?' · '+gap:''}${sources?'\n发现所在目录 · '+sources:''}${remaining?' · 其他 '+remaining+' 条':''}${details}`,
      en:`Round ${round.number} · ${round.filesScanned} files · ${findings.length} new findings${enInfo}${gap?' · '+gap:''}${sources?'\nFinding locations · '+sources:''}${remaining?' · '+remaining+' elsewhere':''}${details}`};
  }
  if(!entry.pages?.baseUrl)throw new Error('请先配置项目预览地址 / Configure the project preview URL first');
  const latest=(await listRounds(entry.id))[0];
  const round=(latest && await getRound(entry.id,latest.id)) || await check(entry,true);
  const route=step.route || entry.pages.routes[0] || '/';
  const sample=await samplePage(entry,round,{suite:step.scope,route,trigger:step.scope==='performance'?'scroll':undefined});
  if('reason' in sample)throw new Error(sample.reason);
  if('sample' in sample){
    const measurement=sample.sample;
    if(measurement.status!=='measured')throw new Error('未取得滚动采样 / Scroll sample unavailable');
    const detail=`${measurement.frameIntervals} frames · p95 ${measurement.p95FrameMs} ms`;
    return {outcome:'observed',zh:route+' · 滚动采样 · '+detail,en:route+' · scroll sample · '+detail,ref:sample.id,roundId:round.id};
  }
  const failed=sample.checks.filter(c=>c.status==='fail').length;
  const gaps=sample.checks.filter(c=>['blocked','not-verified'].includes(c.status)).length;
  const measured=sample.checks.some(c=>c.check!=='page-load' && (c.status==='pass'||c.status==='fail'));
  const outcome=failed || sample.findings.length?'findings':gaps || !measured?'limited':'observed';
  return {outcome,ref:sample.id,roundId:round.id,
    zh:`${route} · 检查失败 ${failed} · 发现 ${sample.findings.length} · 待核验 ${gaps}`,
    en:`${route} · failed checks ${failed} · findings ${sample.findings.length} · unverified ${gaps}`};
}

async function drive(entry:ProjectEntry,runId:string,check:Check){
  if(workers.has(entry.id))return;
  workers.add(entry.id);
  try {
    while(true){
      let board=read(entry),run=board.runs.at(-1)!;
      if(run.id!==runId || run.status!=='active')return;
      const step=run.steps[run.index];
      if(!automatic(step) || step.result)return;
      let result:Evidence|undefined,hold:string|undefined;
      try {result=await execute(entry,step,check);}
      catch(error){hold=error instanceof Error?error.message:String(error);}
      board=read(entry);run=board.runs.at(-1)!;
      if(run.id!==runId || run.status!=='active' || run.steps[run.index].id!==step.id)return;
      Object.assign(run.steps[run.index],{result,hold});
      const keepGoing=!!result && result.outcome==='observed' && run.mode==='auto';
      if(keepGoing)advance(run);
      save(entry,board);
      if(!keepGoing || run.status!=='active')return;
    }
  } finally {workers.delete(entry.id);}
}

export async function boardEvidence(entry:ProjectEntry):Promise<Evidence[]>{
  const run=read(entry).runs.at(-1);
  if(run?.status!=='active')return [];
  const step=run.steps[run.index],since=step.enteredAt || run.at;
  const used=new Set(run.steps.flatMap(s=>s.result?[s.result.ref]:[]));
  const fresh=(id:string,at:string)=>at>=since && !used.has(id);
  if(step.kind==='repair'){
    const prior=run.steps.slice(0,run.index).filter(s=>s.result && s.kind==='test');
    const source=step.from?prior.find(s=>s.id===step.from):prior.filter(s=>step.scope==='full'||s.scope===step.scope||s.scope==='full'||(step.scope==='logic'&&s.scope.startsWith('task-'))).at(-1);
    const scope=step.scope.startsWith('task-')?step.scope:source?.scope;
    if(scope?.startsWith('task-')){
      const task=taskWorkspace(entry).tasks.find(t=>t.id===scope.slice(5));
      return (task?.attempts||[]).filter(a=>a.repairOf&&fresh(a.id,a.at)&&(!source?.scope.startsWith('task-')||a.repairOf===source.result?.ref))
        .map(a=>({outcome:a.status==='pass'?'observed':a.status==='fail'?'findings':'limited',zh:'原场景修后复检 · '+a.status,en:'Same-scenario repair retest · '+a.status,ref:a.id,roundId:a.roundId}));
    }
  }
  if(step.kind==='repair' || step.scope==='logic'){
    const chat=await getProjectAgent(entry.id);
    return chat.messages.filter(m=>fresh(m.id,m.at) && (step.kind==='repair'?
      m.role==='tool' && !!m.backupId && !m.undone:m.kind==='journey-result')).map(m=>{
      const status=m.data?.status,repair=step.kind==='repair';
      const description=repair?m.path || m.id:String(m.data?.name || '')+' · '+String(status);
      return {outcome:repair?'observed':status==='pass'?'observed':status==='fail'?'findings':'limited',
        zh:(repair?'已写入项目文件，待复检 · ':'场景结果 · ')+description,en:(repair?'Project file edited; retest pending · ':'Scenario result · ')+description,
        ref:m.id,roundId:typeof m.data?.roundId==='string'?m.data.roundId:undefined};
    });
  }
  if(step.scope!=='usability' && step.scope!=='fidelity')return [];
  type RecordRow={id:string;at:string;roundId:string;task?:string;outcome?:string;friction?:string;locator?:string;status?:string};
  const visual=step.scope==='fidelity';
  const rows=await readRecords<RecordRow>(entry,visual?'comparisons':'sessions');
  return rows.filter(r=>fresh(r.id,r.at)).map(r=>{
    const text=visual?r.locator+' · '+r.status:r.task+' · '+r.outcome+' · '+r.friction;
    return {ref:r.id,roundId:r.roundId,zh:text,en:text,outcome:visual?(r.status==='unaligned'?'limited':r.status==='review'?'findings':'observed'):
      r.outcome==='independent' && r.friction==='none'?'observed':'findings'};
  });
}

export function boardCommand(entry:ProjectEntry,input:Record<string,unknown>,check:Check,adopted?:Evidence){
  const board=read(entry);
  if(input.revision!==board.revision)return reject(409,'工作流已更新，请刷新后重试 / Workflow changed. Refresh and try again.');
  let run=board.runs.at(-1);
  const active=run?.status==='active', op=input.action;
  let launch=false;
  if(op==='save'){
    if(active)return reject(409,'请结束本次运行后再编排 / Finish this run before editing');
    board.steps=parseSteps(input.steps,entry);
  } else if(op==='mode'){
    if(input.mode!=='manual' && input.mode!=='auto')return reject(400,'请选择运行模式 / Choose a run mode');
    board.mode=input.mode;
    if(active){
      run!.mode=input.mode;
      const step=run!.steps[run!.index];
      launch=input.mode==='auto' && !workers.has(entry.id) && !step.result && !step.hold;
    }
  } else if(op==='start'){
    if(active || workers.has(entry.id) || !board.steps.length)return reject(409,'请先添加步骤或结束当前运行 / Add steps or finish the current run');
    const invalid=board.steps.findIndex((s,i)=>s.from && !board.steps.slice(0,i).some(p=>p.id===s.from && p.kind==='test'));
    if(invalid!==-1)return reject(400,`第 ${invalid+1} 列的依据需要移到其前面，或重新选择依据 / Step ${invalid+1} needs an earlier source test. Move it or choose another input.`);
    run={id:randomUUID(),at:new Date().toISOString(),mode:board.mode,status:'active',index:0,steps:board.steps.map(s=>({...s}))};
    run.steps[0].enteredAt=run.at;board.runs.push(run);launch=run.mode==='auto';
  } else {
    if(!run || !active || run.id!==input.runId || run.steps[run.index].id!==input.stepId)return reject(409,'当前步骤已变化 / The current step has changed');
    if(workers.has(entry.id))return reject(409,'当前检测正在运行 / The current check is running');
    const step=run.steps[run.index];
    if(op==='stop')run.status='stopped';
    else if(op==='execute' && automatic(step) && !step.result){delete step.hold;launch=true;}
    else if(op==='adopt' && !automatic(step) && !step.result && adopted){step.result=adopted;}
    else if(op==='record' && !automatic(step) && !step.result){
      const note=typeof input.note==='string'?input.note.trim():'',ref=typeof input.ref==='string'?input.ref.trim():'';
      if(!note || note.length>2000 || !ref || ref.length>500)return reject(400,'请填写结果和证据位置 / Enter an outcome and an evidence reference');
      step.result={outcome:'manual',zh:note,en:note,ref};
    } else if(op==='next' && step.result){advance(run);launch=run.mode==='auto' && run.status==='active';}
    else return reject(409,'此步骤暂不能执行该操作 / This action is unavailable for the step');
  }
  save(entry,board);
  if(launch && run && automatic(run.steps[run.index]))void drive(entry,run.id,check).catch(error=>console.error('Workflow storage error',error instanceof Error?error.name:'Error'));
  return boardView(entry);
}
