import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { exportScripts } from '../src/figma/exporter.js';
import { auditFigma } from '../src/figma/audit.js';
import { auditGraph, validateGraph } from '../src/figma/graph.js';
import { runFigmaCommand } from '../src/figma/cli.js';
import { unpackCapture } from '../src/figma/transport.js';
import { validateChunk, validateConfig } from '../src/figma/validate.js';
import type { FigmaChunk,FigmaIndex } from '../src/figma/types.js';

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const config=validateConfig({fileKey:'sample',pageId:'1:1',themes:[{name:'浅色',background:[1,1,1,1]},{name:'深色',background:[0,0,0,1]}]});
function fixture(count:number){
  const all=new Map<string,any>();
  const node=(id:string,type:string,name:string,parent:any=null,extra:Record<string,unknown>={})=>{
    const n={id,type,name,parent,children:[] as any[],width:30,height:30,x:0,y:0,opacity:1,visible:true,fills:[],strokes:[],...extra};
    parent?.children.push(n);all.set(id,n);return n;
  };
  const page=Object.assign(node('1:1','PAGE','Test page'),{flowStartingPoints:[] as {nodeId:string,name:string}[],findAllWithCriteria:()=>[...all.values()].filter(o=>o.type==='COMPONENT')});
  for(let i=0;i<count;i++){
    const root=node('2:'+i,'COMPONENT','Variation '+i,page,{variantProperties:i===0?{'禁用':'是','开':'是'}:{'禁用':'否','开':'是'},opacity:i===0?0.5:1});
    node('3:'+i,'TEXT','Label',root,{characters:'按钮',fontSize:14,fontName:{family:'Example',style:'Regular'},fills:[{type:'SOLID',boundVariables:{color:{id:'v'}}}]});
  }
  const a=node('4:1','FRAME','Start',page),b=node('4:2','FRAME','Menu',page),c=node('4:3','FRAME','Dialog',page);
  const d=node('4:4','FRAME','Independent',page),e=node('4:5','FRAME','Loop',page);
  const nav=(n:any,dest:string|null,kind='NAVIGATE')=>n.reactions=[{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',navigation:kind,destinationId:dest}]}];
  nav(a,b.id,'OVERLAY');nav(b,c.id,'OVERLAY');nav(c,'99:404');nav(e,e.id);
  node('5:1','TEXT','Label',d,{characters:'标签'});
  for(const [screen,offset,val] of [[a,10,'12'],[b,20,'15']] as const){
    for(const [i,text] of ['record7','count','rev1',val].entries())node('6:'+(offset+i),'TEXT','Fact',screen,{characters:text});
  }
  const rect={x:10,y:5,width:30,height:25};const hot1=node('5:2','RECTANGLE','First',a,{absoluteBoundingBox:rect}),hot2=node('5:3','RECTANGLE','Second',a,{absoluteBoundingBox:rect});nav(hot1,b.id);nav(hot2,c.id);
  page.flowStartingPoints=[{nodeId:a.id,name:'Start'}];
  const messages:any[]=[];
  const figma={fileKey:'sample',getNodeByIdAsync:async(id:string)=>all.get(id)??null,setCurrentPageAsync:async()=>{},showUI:()=>{},
    variables:{getVariableByIdAsync:async()=>({variableCollectionId:'colors',valuesByMode:{l:{r:.898,g:.282,b:.314},d:{r:1,g:1,b:1}}}),
      getVariableCollectionByIdAsync:async()=>({id:'colors',name:'Colors',modes:[{name:'Light',modeId:'l'},{name:'Dark',modeId:'d'}]})},
    ui:{onmessage:undefined as undefined|((cmd:string)=>Promise<void>),postMessage:(m:unknown)=>messages.push(m)}};
  return {figma,all,page,messages};
}

it('executes the generated local exporter for 750 masters, reconciles coverage and rejects edited observations',async()=>{
  const f=fixture(750),scripts=exportScripts(config,'round');
  await new AsyncFunction('figma','__html__',scripts.plugin)(f.figma,'');
  await f.figma.ui.onmessage!('all');
  const bundle=f.messages.at(-1)?.done;expect(bundle,JSON.stringify(f.messages.at(-1)?.error)).toBeDefined();
  expect(bundle.chunks.map((c:FigmaChunk)=>c.components.length)).toEqual([128,128,128,128,128,110]);
  expect(bundle.index.modeBindings.map((m:{mode:string})=>m.mode)).toEqual(['Light','Dark']);
  const report=auditFigma(bundle.index,bundle.chunks);
  expect(report.status).toBe('complete');expect(report.coverage.pageTotal).toBe(750);
  expect(auditFigma({...bundle.index,contentFingerprint:undefined},bundle.chunks).status).toBe('partial');
  expect(report.checks.filter(c=>c.nodeId==='2:0').map(c=>c.rule)).toEqual(['disabled-exclusion']);
  expect(report.checks.find(c=>c.nodeId==='3:1'&&c.rule==='text-contrast'&&c.theme==='浅色')?.observed).toBeGreaterThan(3);
  expect(report.checks.some(c=>c.rule==='copy-placeholder')).toBe(false);
  const first=bundle.chunks[0] as FigmaChunk;
  const shortened={...bundle.index,componentIds:first.components.slice(0,20).map(c=>c.id)};
  expect(validateChunk(first,shortened)).toBe(first);
  expect(auditFigma(shortened,[first]).coverage).toMatchObject({pageTotal:750,expectedComponents:20});
  expect(auditFigma(shortened,[first]).status).toBe('partial');
  const damaged=structuredClone(first);damaged.components[0].width++;
  expect(()=>validateChunk(damaged,bundle.index)).toThrow(/changed/);
  const dir=await mkdtemp(join(tmpdir(),'qa-capture-'));
  try{
    const file=join(dir,'capture.json'),out=join(dir,'ingested');await writeFile(file,JSON.stringify(bundle));
    expect(await runFigmaCommand(['ingest','--from',file,'--out',out])).toBe(0);
    expect(await runFigmaCommand(['ingest','--from',file,'--out',out])).toBe(0);
    expect(await runFigmaCommand(['check','--input',out,'--out',join(dir,'report'),'--fail-on','fail'])).toBe(1); // low contrast on white
    const full=JSON.parse(await readFile(join(dir,'report/figma.json'),'utf8'));
    expect(full.status).toBe('complete');
    const indexPath=join(out,'index.json'),edited=JSON.parse(await readFile(indexPath,'utf8'));edited.pageName='edited';await writeFile(indexPath,JSON.stringify(edited));
    await runFigmaCommand(['check','--input',out,'--out',join(dir,'altered')]);
    expect(JSON.parse(await readFile(join(dir,'altered/figma.json'),'utf8')).status).toBe('partial');
  }finally{await rm(dir,{recursive:true,force:true});}
},40000);

it('rejects an unavailable theme during indexing, and round-trips compact MCP output through ingest',async()=>{
  const f=fixture(60),scripts=exportScripts(config,'round');
  const bad=exportScripts({...config,themes:[{name:'Unknown',background:[1,1,1,1]}]},'bad');
  await expect(new AsyncFunction('figma',bad.index)(f.figma)).rejects.toThrow(/Light, Dark/);
  const corrected=exportScripts({...config,themes:[{name:'Brand',modes:{colors:'Dark'},background:[1,1,1,1]}]},'fixed');
  expect((await new AsyncFunction('figma',corrected.index)(f.figma)).modeBindings[0].mode).toBe('Dark');
  const index:FigmaIndex=await new AsyncFunction('figma',scripts.index)(f.figma);
  const raw=await new AsyncFunction('figma',scripts.collect.replace('const UXQA_IDS = [];','const UXQA_IDS = '+JSON.stringify(index.componentIds)+';'))(f.figma);
  expect(Buffer.byteLength(JSON.stringify(raw))).toBeLessThanOrEqual(43000);
  expect(validateChunk(unpackCapture(raw),index).components).toHaveLength(60);
  const dir=await mkdtemp(join(tmpdir(),'qa-mcp-'));
  try{const path=join(dir,'result.json'),out=join(dir,'evidence');
    for(const input of [index,raw]){await writeFile(path,JSON.stringify({content:[{type:'text',text:JSON.stringify(input)}]}));
      expect(await runFigmaCommand(['ingest','--from-mcp-result',path,'--out',out])).toBe(0);}
  }finally{await rm(dir,{recursive:true,force:true});}
});

it('follows declared entries and conditional navigation, identifies broken links and keeps terminal screens and overlaps as review',async()=>{
  const f=fixture(0),refs=(n:number)=>({object:'6:'+n,field:'6:'+(n+1),version:'6:'+(n+2),value:'6:'+(n+3)});
  const scripts=exportScripts({...config,sameFacts:[{name:'assignment count',left:refs(10),right:refs(20)}]},'graph');
  f.all.get('4:2').reactions[0].actions=[{type:'CONDITIONAL',conditionalBlocks:[{actions:[{type:'NODE',navigation:'OVERLAY',destinationId:'4:3'}]}]}];
  const raw=await new AsyncFunction('figma',scripts.graph)(f.figma),g=validateGraph(unpackCapture(raw));
  const r=auditGraph(g);expect(r.reachable?.sort()).toEqual(['4:1','4:2','4:3']);
  for(const rule of ['nested-overlay','unreachable-screen','closed-loop','overlapping-actions','copy-placeholder'])expect(r.checks.find(c=>c.rule===rule)?.status).toBe('review');
  expect(r.checks.find(c=>c.rule==='broken-destination')?.status).toBe('fail');
  expect(r.checks.find(c=>c.rule==='same-fact')?.status).toBe('fail');
  f.all.get('6:22').characters='rev2';const different=auditGraph(validateGraph(await new AsyncFunction('figma',scripts.graph)(f.figma)));
  expect(different.checks.find(c=>c.rule==='same-fact')?.status).toBe('not-verified');
  expect(auditGraph({...g,starts:[]}).checks.some(c=>c.rule==='unreachable-screen')).toBe(false);
});

it('exports 14,000 actions through the generated development plugin and uses the requested CI gate on the imported graph',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-plugin-graph-'));
  try{
    const configPath=join(dir,'config.json'),pluginDir=join(dir,'plugin'),input=join(dir,'graph.json'),out=join(dir,'capture');
    await writeFile(configPath,JSON.stringify(config));
    expect(await runFigmaCommand(['prepare','--config',configPath,'--out',pluginDir])).toBe(0);
    const f=fixture(0);
    for(const n of f.all.values())if(n.reactions)n.reactions=[];
    f.all.get('4:1').reactions=[{trigger:{type:'ON_CLICK'},actions:Array.from({length:14000},()=>({type:'NODE',navigation:'NAVIGATE',destinationId:'4:2'}))}];
    new Function('figma','__html__',await readFile(join(pluginDir,'plugin.js'),'utf8'))(f.figma,'');
    await f.figma.ui.onmessage!('graph');
    const graph=f.messages.at(-1)?.done;
    expect(graph?.edges).toHaveLength(14000);
    await writeFile(input,JSON.stringify(graph));
    expect(await runFigmaCommand(['ingest','--from',input,'--out',out])).toBe(0);
    expect(await runFigmaCommand(['graph','--input',out,'--out',join(dir,'strict')])).toBe(1);
    expect(await runFigmaCommand(['graph','--input',out,'--out',join(dir,'ci'),'--fail-on','fail'])).toBe(0);
    const saved=JSON.parse(await readFile(join(dir,'ci','graph.json'),'utf8'));
    expect(saved.transitions).toHaveLength(14000);
    expect(saved.reachable.sort()).toEqual(['4:1','4:2']);
    expect(await runFigmaCommand(['graph','--input',configPath,'--out',join(dir,'invalid'),'--fail-on','fail'])).toBe(2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
