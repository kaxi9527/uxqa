import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureMeta, FactNodes, FigmaCheck } from './types.js';
import { validateMeta } from './validate.js';
import { contentFingerprint } from './semantics.js';
import { md } from './reports.js';

export interface Prototype extends CaptureMeta {
  kind:'prototype'; pageName:string; starts:string[];
  frames:Array<{id:string;name:string;section:string}>;
  edges:Array<{from:string;node:string;action:string;target:string|null;scope:'screen'|'external'|'missing'|'other-node'|'unknown'|'none'}>;
  copy:Array<{frame:string;node:string;text:string}>;
  hotspots:Array<{frame:string;parent:string;node:string;x:number;y:number;width:number;height:number}>;
  facts?:Array<{name:string;left:FactObservation;right:FactObservation}>;
}
type FactObservation={frame:string|null;nodes:FactNodes;values:Record<keyof FactNodes,string|null>};

// Read only this page. A target on another page is an external boundary, never a dangling link.
export const GRAPH_COLLECT=String.raw`
const frames=[],edges=[],copy=[],hotspots=[],owners=new Map(),sources=[];
function explore(n,owner,section){
  if(n.visible===false)return;
  if(n.type==='SECTION'){for(const child of n.children||[])explore(child,owner,n.id);return;}
  if(!owner){
    if(n.type==='COMPONENT'||n.type==='COMPONENT_SET')return;
    if(['FRAME','INSTANCE','GROUP'].includes(n.type)){owner=n.id;frames.push({id:n.id,name:n.name,section});}
  }
  if(owner){
    owners.set(n.id,owner);
    if(n.reactions?.length)sources.push({n,owner});
    if(n.type==='TEXT'&&/^(按钮|标签|占位文本|your text|title here)$/i.test(n.characters.trim()))copy.push({frame:owner,node:n.id,text:n.characters.trim()});
  }
  for(const child of n.children||[])explore(child,owner,section);
}
for(const node of page.children||[])explore(node,null,'');
const dests=new Map();
async function destination(id){
  if(!id)return {target:null,scope:'missing'};
  if(owners.has(id))return {target:owners.get(id),scope:'screen'};
  if(!dests.has(id)){let scope='unknown';try{const dest=await figma.getNodeByIdAsync(id);if(!dest)scope='missing';else{let p=dest;while(p&&p.type!=='PAGE')p=p.parent;scope=p&&p.id!==page.id?'external':'other-node';}}catch{}
    dests.set(id,{target:id,scope});}
  return dests.get(id);
}
async function action(a,owner,node){
  if(!a)return;
  if(a.type==='CONDITIONAL'){for(const branch of a.conditionalBlocks||[])for(const nested of branch.actions||[])await action(nested,owner,node);return;}
  const target=a.type==='NODE'?await destination(a.destinationId):{target:null,scope:'none'};
  edges.push({from:owner,node,action:a.type==='NODE'?a.navigation:a.type,...target});
}
for(const {n,owner} of sources){
  if(n.reactions.some(r=>['ON_CLICK','ON_PRESS','ON_DRAG'].includes(r.trigger?.type))&&n.absoluteBoundingBox){const {x,y,width,height}=n.absoluteBoundingBox;hotspots.push({node:n.id,parent:n.parent.id,frame:owner,x,y,width,height});}
  for(const r of n.reactions)for(const a of (r.actions?.length?r.actions:r.action?[r.action]:[]))await action(a,owner,n.id);
}
const starts=(page.flowStartingPoints||[]).map(s=>owners.get(s.nodeId)||s.nodeId);
async function readFact(nodes){
  const values={},screens=new Set();for(const key of ['object','field','version','value']){
    const id=nodes[key],screen=owners.get(id);screens.add(screen||null);
    const n=screen?await figma.getNodeByIdAsync(id):null;values[key]=n?.type==='TEXT'&&n.characters.trim()?n.characters.trim():null;
  }
  return {nodes,frame:screens.size===1?[...screens][0]:null,values};
}
const facts=[];for(const spec of UXQA_CONFIG.sameFacts||[])facts.push({name:spec.name,left:await readFact(spec.left),right:await readFact(spec.right)});
return emit({...meta(),kind:'prototype',pageName:page.name,starts,frames,edges,copy,hotspots,facts});
`;

export function validateGraph(raw:unknown):Prototype {
  if (!raw || typeof raw!=='object')throw new Error('Expected a prototype capture');
  const graph=raw as Prototype;
  validateMeta(raw as Record<string,unknown>);
  if(graph.contentFingerprint!==undefined&&contentFingerprint(raw as Record<string,unknown>)!==graph.contentFingerprint)throw new Error('Prototype payload changed since capture');
  if(graph.kind!=='prototype'||typeof graph.pageName!=='string')throw new Error('Expected prototype graph with a page name');
  for(const rows of [graph.frames,graph.edges,graph.starts,graph.copy,graph.hotspots])if(!Array.isArray(rows)||rows.length>300000)throw new Error('Invalid prototype table');
  const isId=(s:unknown)=>typeof s==='string'&&/^(?:I)?\d+:\d+(?:;\d+:\d+)*$/.test(s);
  const ids=new Set<string>();
  for(const f of graph.frames){if(!f||!isId(f.id)||ids.has(f.id)||typeof f.name!=='string'||typeof f.section!=='string')throw new Error('Invalid or duplicate screen');ids.add(f.id);}
  if(!graph.starts.every(isId))throw new Error('Invalid prototype entry');
  for(const e of graph.edges)if(!e||!ids.has(e.from)||!isId(e.node)||typeof e.action!=='string'||!['screen','external','missing','other-node','unknown','none'].includes(e.scope)||(e.target!==null&&!isId(e.target))||(e.scope==='screen'&&!ids.has(e.target!)))throw new Error('Invalid prototype action');
  for(const c of graph.copy)if(!c||!ids.has(c.frame)||!isId(c.node)||typeof c.text!=='string')throw new Error('Invalid copy observation');
  for(const h of graph.hotspots)if(!h||!ids.has(h.frame)||!isId(h.parent)||!isId(h.node)||![h.x,h.y,h.width,h.height].every(Number.isFinite)||h.width<0||h.height<0)throw new Error('Invalid action bounds');
  if(graph.facts!==undefined){
    if(!Array.isArray(graph.facts)||graph.facts.length>50000)throw new Error('Invalid fact observations');
    for(const f of graph.facts){if(!f||typeof f.name!=='string')throw new Error('Invalid fact name');
      for(const s of [f.left,f.right]){
        if(!s||!s.nodes||!s.values||(s.frame!==null&&!ids.has(s.frame)))throw new Error('Invalid fact scope');
        const keys=['object','field','version','value'] as const;
        if(new Set(keys.map(k=>s.nodes[k])).size!==4||keys.some(k=>!isId(s.nodes[k])||(s.values[k]!==null&&typeof s.values[k]!=='string')))throw new Error('Invalid fact evidence');
      }
    }
  }
  return graph;
}

export function auditGraph(g:Prototype) {
  const checks:FigmaCheck[]=[],frames=new Map(g.frames.map(f=>[f.id,f])),paths=new Map<string,Set<string>>(),incoming=new Set<string>(),overlays=new Set<string>(),exits=new Set<string>();
  const add=(rule:string,status:FigmaCheck['status'],frame:string,node:string,message:string)=>checks.push({rule,status,component:frames.get(frame)?.name??g.pageName,nodeId:node,message});
  if(!g.contentFingerprint)add('capture-integrity','not-verified',g.pageId,g.pageId,'缺少原始采集内容指纹 / Original graph checksum unavailable');
  for(const e of g.edges){
    if(e.scope==='missing')add('broken-destination','fail',e.from,e.node,'目标已失效 / Missing destination: '+(e.target??'null'));
    if(e.scope==='unknown')add('unreadable-destination','not-verified',e.from,e.node,'目标无法读取 / Destination unavailable');
    if(['BACK','CLOSE','URL'].includes(e.action))exits.add(e.from);
    if(!['NAVIGATE','OVERLAY','SWAP'].includes(e.action))continue;
    if(e.scope==='external'){exits.add(e.from);add('cross-page','review',e.from,e.node,'目标位于本页之外 / Destination on another page: '+e.target);continue;}
    if(e.scope!=='screen'){if(e.scope==='other-node')add('outside-screen','not-verified',e.from,e.node,'目标未归入本页画板 / Destination outside screen inventory');continue;}
    const dest=e.target!;
    if(!paths.has(e.from))paths.set(e.from,new Set());
    paths.get(e.from)!.add(dest);incoming.add(dest);
    if(e.action==='OVERLAY')overlays.add(dest);
  }
  for(const e of g.edges)if(e.action==='OVERLAY'&&e.scope==='screen'&&overlays.has(e.from))add('nested-overlay','review',e.from,e.node,'弹层打开另一层 / Overlay opens another overlay: '+e.target);
  const entries=new Set(g.starts.filter(id=>frames.has(id))),reachable=new Set(entries),queue=[...entries];
  for(let i=0;i<queue.length;i++)for(const next of paths.get(queue[i])??[])if(!reachable.has(next)){reachable.add(next);queue.push(next);}
  const knownStarts=entries.size>0 && g.starts.every(id=>frames.has(id));
  if(!knownStarts)add('prototype-entries','not-verified',g.pageId,g.pageId,'未获得完整的显式起点，可达性待验证 / No complete declared entry set');
  for(const f of g.frames){
    if(knownStarts&&!reachable.has(f.id))add('unreachable-screen','review',f.id,f.id,'从声明起点无已采集路径 / No captured path from a declared entry');
    const next=paths.get(f.id);
    if(!next?.size&&!exits.has(f.id))add(!incoming.has(f.id)&&!entries.has(f.id)?'isolated-screen':'no-exit','review',f.id,f.id,'无已采集出口，请确认是否是终点或独立样例 / Confirm intended terminal or standalone frame');
  }
  // Strongly connected components identify closed loops without enumerating all possible paths.
  const reversed=new Map<string,string[]>();for(const [from,tos] of paths)for(const to of tos){if(!reversed.has(to))reversed.set(to,[]);reversed.get(to)!.push(from);}
  const visited=new Set<string>(),order:string[]=[];
  for(const start of frames.keys()){
    const stack:[string,boolean][]=[[start,false]];
    while(stack.length){const [id,exit]=stack.pop()!;if(exit){order.push(id);continue;}if(visited.has(id))continue;visited.add(id);stack.push([id,true]);for(const to of paths.get(id)??[])if(!visited.has(to))stack.push([to,false]);}
  }
  visited.clear();
  for(const start of order.reverse()){
    if(visited.has(start))continue;const group=new Set<string>(),stack=[start];visited.add(start);
    while(stack.length){const id=stack.pop()!;group.add(id);for(const prev of reversed.get(id)??[])if(!visited.has(prev)){visited.add(prev);stack.push(prev);}}
    if((group.size>1||paths.get(start)?.has(start))&&[...group].every(id=>!exits.has(id)&&[...(paths.get(id)??[])].every(to=>group.has(to))))add('closed-loop','review',start,start,'本组无已采集外部出口 / Closed screen loop: '+[...group].join(', '));
  }
  for(const c of g.copy)add('copy-placeholder','review',c.frame,c.node,'页面或实例中文字疑似占位 / Possible placeholder: '+c.text);
  for(const {name,left,right} of g.facts??[]){
    const comparable=left.frame && right.frame && left.frame!==right.frame && left.nodes.value!==right.nodes.value &&
      (['object','field','version'] as const).every(k=>left.values[k]?.trim()&&left.values[k]===right.values[k]) && left.values.value?.trim() && right.values.value?.trim();
    add('same-fact',!comparable?'not-verified':left.values.value===right.values.value?'pass':'fail',right.frame??g.pageId,right.nodes.value,
      name+' · '+(!comparable?'对象、字段、版本或独立画板未对齐 / Comparable identity, field, version and screens not established':JSON.stringify(left.values.value)+' ↔ '+JSON.stringify(right.values.value)));
  }
  const siblings=new Map<string,Prototype['hotspots']>();for(const h of g.hotspots){if(!siblings.has(h.parent))siblings.set(h.parent,[]);siblings.get(h.parent)!.push(h);}
  for(const rows of siblings.values()){
    rows.sort((a,b)=>a.x-b.x);
    for(let i=0;i<rows.length;i++){const a=rows[i];for(let j=i+1;j<rows.length&&rows[j].x<a.x+a.width;j++){
      const b=rows[j];if(b.width>0&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y))add('overlapping-actions','review',a.frame,a.node,'同级可操作矩形相交，核对实际命中 / Intersecting sibling action bounds: '+b.node);
    }}
  }
  return {source:{fileKey:g.fileKey,fileKeyObserved:g.fileKeyObserved??false,pageId:g.pageId,pageName:g.pageName,exportId:g.exportId,capturedAt:g.capturedAt},frames:g.frames.length,actions:g.edges.length,screens:g.frames,transitions:g.edges,facts:g.facts??[],entries:[...entries],reachable:knownStarts?[...reachable]:null,checks};
}

export async function writeGraphReport(g:Prototype,out:string) {
  const report=auditGraph(g);
  const link=(id:string)=>'['+md(id)+'](https://www.figma.com/design/'+encodeURIComponent(g.fileKey)+'?node-id='+encodeURIComponent(id)+')';
  const lines=['# QA Master · Prototype',md(g.pageName),'',g.frames.length+' screens · '+g.edges.length+' actions · '+g.starts.length+' declared entries','',
    '原型起点 / Flow starts · '+(g.starts.map(link).join(', ')||'未声明 / None declared'),'',
    '可达性包含所有可选分支。运行时条件、实际点击命中和产品行为需要另行验证。 / Reachability includes possible branches. Runtime state and actual hit testing require separate evidence.',''];
  for(const c of report.checks)lines.push('- '+c.status+' · '+c.rule+' · '+link(c.nodeId)+' · '+md(c.message));
  await writeFile(join(out,'graph.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  await writeFile(join(out,'graph.md'),lines.join('\n')+'\n',{flag:'wx',mode:0o600});return report;
}
