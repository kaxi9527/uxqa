import type { FigmaConfig } from './types.js';
import { contentFingerprint, disabledProperties, inventoryFingerprint } from './semantics.js';
import { GRAPH_COLLECT } from './graph.js';

/** Generated code only reads document nodes/variables. Page selection is the sole UI operation. */
export function exportScripts(config: FigmaConfig, exportId: string) {
  const prefix = `const UXQA_CONFIG = ${JSON.stringify(config)};\nconst UXQA_EXPORT_ID = ${JSON.stringify(exportId)};\n`;
  const setup = 'const inventoryFingerprint='+inventoryFingerprint.toString()+';\nconst contentFingerprint='+contentFingerprint.toString()+';\nconst isDisabled='+disabledProperties.toString()+';\n'+String.raw`
let observedFileKey;try{observedFileKey=figma.fileKey;}catch{}
if (observedFileKey && observedFileKey !== UXQA_CONFIG.fileKey) throw Error('QA Master file scope mismatch');
const page = await figma.getNodeByIdAsync(UXQA_CONFIG.pageId);
if (!page || page.type !== 'PAGE') throw Error('QA Master page not found');
await figma.setCurrentPageAsync(page);
const meta = () => ({schemaVersion:1,exportId:UXQA_EXPORT_ID,fileKey:UXQA_CONFIG.fileKey,fileKeyObserved:!!observedFileKey,pageId:page.id,capturedAt:new Date().toISOString()});
const seal=value=>({...value,contentFingerprint:contentFingerprint(value)});
const componentIds=()=>page.findAllWithCriteria({types:['COMPONENT']}).map(n=>n.id).sort();
const witness=ids=>({total:ids.length,fingerprint:inventoryFingerprint(ids)});
const modeBindings=new Map();
function modeFor(c,T){
  const requested=T.modes?.[c.id]||T.mode||T.name;
  const lower=s=>s.trim().toLowerCase();
  const alias=s=>({'浅色':'light','亮色':'light','深色':'dark','暗色':'dark'}[lower(s)]||lower(s));
  const direct=c.modes.filter(m=>lower(m.name)===lower(requested));
  const matches=direct.length?direct:c.modes.filter(m=>alias(m.name)===alias(requested));
  const selected=matches.length===1?matches[0]:c.modes.length===1?c.modes[0]:null;
  if(!selected)throw Error('主题模式不匹配 / Theme mode mismatch: '+T.name+' → '+requested+'; '+(c.name||c.id)+' ['+c.id+'] available: '+c.modes.map(m=>m.name).join(', ')+'. Set theme.mode or theme.modes[collectionId].');
  modeBindings.set(c.id+'|'+T.name,{collection:c.id,theme:T.name,mode:selected.name});
  return selected;
}
const byteLength=s=>encodeURIComponent(s).replace(/%[0-9A-F]{2}/g,'x').length;
const bounded = raw => {const value=seal(raw),s=JSON.stringify(value);if(byteLength(s)<=43000)return value;
  const counts=new Map(),tokens=s.match(/"(?:\\.|[^"\\])*"/g)||[];for(const token of tokens)counts.set(token,(counts.get(token)||0)+1);
  const dictionary=[],refs=new Map();for(const [token,count]of counts)if(token.length>7&&count>1){refs.set(token,dictionary.length);dictionary.push(JSON.parse(token));}
  const payload=s.replace(/"(?:\\.|[^"\\])*"/g,token=>refs.has(token)?'@'+refs.get(token):token);
  const packed={encoding:'uxqa-json-dictionary-v1',dictionary,payload};
  if(byteLength(JSON.stringify(packed))<=43000)return packed;
  const shapes=[],shapeIds=new Map();
  function row(v){if(Array.isArray(v))return [-1,...v.map(row)];if(v!==null&&typeof v==='object'){
    const k=Object.keys(v),key=JSON.stringify(k);if(!shapeIds.has(key)){shapeIds.set(key,shapes.length);shapes.push(k);}
    return [shapeIds.get(key),...k.map(key=>row(v[key]))];}return v;}
  const compact={encoding:'qa-master-rows-v1',data:row(JSON.parse(s)),shapes};
  if(byteLength(JSON.stringify(compact))>43000)throw Error('MCP return exceeds 43000 bytes; use the local capture plugin or fewer IDs. No evidence was truncated.');return compact;};
`;
  const indexBody = String.raw`
const roots=page.findAllWithCriteria({types:['COMPONENT']}),ids=roots.map(n=>n.id).sort(),refs=new Set(),variables=new Map(),collections=new Map();
function paintRefs(n){for(const field of ['fills','strokes'])if(Array.isArray(n[field]))for(const p of n[field])if(p.visible!==false&&p.boundVariables?.color)refs.add(p.boundVariables.color.id);}
function visit(n){if(n.visible===false)return;paintRefs(n);for(const c of n.children||[])visit(c);}
for(const root of roots){visit(root);for(let a=root.parent;a&&a.type!=='PAGE';a=a.parent)paintRefs(a);}
async function tokenColor(id,T,chain=[]){
  if(chain.includes(id)||chain.length>20)return null;
  if(!variables.has(id))variables.set(id,await figma.variables.getVariableByIdAsync(id));const v=variables.get(id);if(!v)return null;
  if(!collections.has(v.variableCollectionId))collections.set(v.variableCollectionId,await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId));
  const c=collections.get(v.variableCollectionId);if(!c)return null;const x=v.valuesByMode[modeFor(c,T).modeId];
  if(x?.type==='VARIABLE_ALIAS')return tokenColor(x.id,T,[...chain,id]);return x&&typeof x.r==='number'?[x.r,x.g,x.b,x.a===undefined?1:x.a]:null;
}
const tokenObservations=[];
for(const T of UXQA_CONFIG.themes){for(const id of refs)await tokenColor(id,T);if(T.backgroundVariableId)await tokenColor(T.backgroundVariableId,T);
  for(const t of UXQA_CONFIG.tokenExpectations||[])if(t.theme===T.name)tokenObservations.push({...t,actual:await tokenColor(t.id,T)});}
return emit({...meta(),kind:'index',pageName:page.name,componentIds:ids,inventory:witness(ids),modeBindings:[...modeBindings.values()],themes:UXQA_CONFIG.themes.map(t=>t.name),forbiddenFonts:UXQA_CONFIG.forbiddenFonts||[],allowedColorPrefixes:UXQA_CONFIG.allowedColorPrefixes||[],tokenObservations});
`;
  const index=prefix+setup+'const emit=bounded;\n'+indexBody;
  const collect=prefix+'const UXQA_IDS = []; // IDs from index.json\n'+setup+'const emit=bounded;\n'+COLLECT;
  const graph=prefix+setup+'const emit=bounded;\n'+GRAPH_COLLECT;
  const plugin=prefix+`figma.showUI(__html__,{width:430,height:240});let running=false;
figma.ui.onmessage=async m=>{if(running || !['all','graph'].includes(m))return;running=true;try{
${setup}
const emit=seal;
const collectGraph=async()=>{${GRAPH_COLLECT}};
if(m==='graph'){figma.ui.postMessage({done:await collectGraph()});return;}
const index=await (async()=>{${indexBody}})(),chunks=[];
const collect=async UXQA_IDS=>{${COLLECT}};
for(let i=0;i<index.componentIds.length;i+=128){
  chunks.push(await collect(index.componentIds.slice(i,i+128)));
  figma.ui.postMessage({progress:Math.min(i+128,index.componentIds.length)+' / '+index.componentIds.length});
}
figma.ui.postMessage({done:{kind:'qa-master-figma-capture',index,chunks,graph:await collectGraph()}});
}catch(e){figma.ui.postMessage({error:String(e.message||e)});}finally{running=false;}};`;
  return {index,collect,graph,plugin};
}

const COLLECT = String.raw`
if (!UXQA_IDS.length || UXQA_IDS.length>128 || new Set(UXQA_IDS).size!==UXQA_IDS.length) throw Error('QA Master needs 1–128 unique component IDs');
const variableCache=new Map(),collectionCache=new Map(),mainCache=new Map();
const variable=async id=>{if(!variableCache.has(id))variableCache.set(id,await figma.variables.getVariableByIdAsync(id));return variableCache.get(id);};
const collection=async id=>{if(!collectionCache.has(id))collectionCache.set(id,await figma.variables.getVariableCollectionByIdAsync(id));return collectionCache.get(id);};
const rgba=c=>[c.r,c.g,c.b,c.a===undefined?1:c.a];
const composite=(f,b)=>[f[0]*f[3]+b[0]*(1-f[3]),f[1]*f[3]+b[1]*(1-f[3]),f[2]*f[3]+b[2]*(1-f[3]),1];
async function resolveColor(id,T,unknown,chain=[]) {
  if(chain.includes(id)||chain.length>20){unknown.add('alias-cycle:'+id);return null;}
  const v=await variable(id);if(!v){unknown.add('missing-variable:'+id);return null;}
  const c=await collection(v.variableCollectionId);if(!c){unknown.add('missing-collection:'+v.variableCollectionId);return null;}
  const mode=modeFor(c,T);
  if(!mode){unknown.add('missing-theme:'+c.id+':'+T.name);return null;}
  const value=v.valuesByMode[mode.modeId];
  if(value&&value.type==='VARIABLE_ALIAS')return resolveColor(value.id,T,unknown,[...chain,id]);
  if(!value||typeof value.r!=='number'){unknown.add('non-color-variable:'+id);return null;}
  return rgba(value);
}
async function paint(p,T,unknown) {
  if(p.type!=='SOLID'){unknown.add('unsupported-paint:'+p.type);return null;}
  if(p.boundVariables&&p.boundVariables.color){
    const c=await resolveColor(p.boundVariables.color.id,T,unknown);
    return c?[c[0],c[1],c[2],c[3]*(p.opacity===undefined?1:p.opacity)]:null;
  }
  return [p.color.r,p.color.g,p.color.b,p.opacity===undefined?1:p.opacity];
}
function livePaints(n,field){return Array.isArray(n[field])?n[field].filter(p=>p.visible!==false):[];}
async function background(n,T,unknown,includeSelf=false){
  let b=T.backgroundVariableId?await resolveColor(T.backgroundVariableId,T,unknown):T.background;
  if(!b)return null;const chain=[];
  for(let a=includeSelf?n:n.parent;a&&a.type!=='PAGE'&&a.type!=='SECTION';a=a.parent)chain.push(a);
  for(const a of chain.reverse()){
    if(a.opacity!==undefined&&a.opacity!==1){unknown.add('group-opacity:'+a.id);return null;}
    for(const p of livePaints(a,'fills')){const c=await paint(p,T,unknown);if(!c)return null;b=composite(c,b);}
  }
  return b;
}
function clipped(n){const b=n.absoluteBoundingBox;if(!b)return false;
  for(let p=n.parent;p&&p.type!=='PAGE'&&p.type!=='SECTION';p=p.parent){if(!p.clipsContent||!p.absoluteBoundingBox)continue;const a=p.absoluteBoundingBox;
    if(b.x<a.x-1||b.y<a.y-1||b.x+b.width>a.x+a.width+1||b.y+b.height>a.y+a.height+1)return true;
  }return false;
}
function walk(n,out){if(n.visible===false)return;out.push(n);if('children'in n)for(const c of n.children)walk(c,out);}
function disabledText(n,root){for(let a=n;a&&a!==root.parent;a=a.parent){
  const props=a.type==='INSTANCE'?a.componentProperties:(a.type==='COMPONENT'?a.variantProperties:null);
  if(props&&isDisabled(props))return true;
}return false;}
function fingerprint(s){let a=2166136261,b=5381;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return (a>>>0).toString(16)+'-'+(b>>>0).toString(16)+':'+s.length;}
const components=[];
for(const id of UXQA_IDS){
  const root=await figma.getNodeByIdAsync(id);if(!root||root.type!=='COMPONENT')throw Error('Not a component: '+id);
  let ancestor=root;while(ancestor&&ancestor.type!=='PAGE')ancestor=ancestor.parent;
  if(!ancestor||ancestor.id!==page.id)throw Error('Component outside requested page: '+id);
  const set=root.parent&&root.parent.type==='COMPONENT_SET'?root.parent:null;
  const props=root.variantProperties||{},nodes=[];walk(root,nodes);
  const disabled=isDisabled(props);
  const icons=[],hitRegions=[],dependencies=new Map(),bindings=new Map(),fonts=new Set(),types={};let unboundPaints=0;
  for(const n of nodes){
    types[n.type]=(types[n.type]||0)+1;
    if(n.type==='TEXT'&&typeof n.fontName!=='symbol')fonts.add(n.fontName.family);
    if(n.type==='INSTANCE'){
      try{const main=await n.getMainComponentAsync();if(main){const previous=dependencies.get(main.id);dependencies.set(main.id,{id:main.id,name:main.parent?.type==='COMPONENT_SET'?main.parent.name:main.name,count:(previous?.count||0)+1});mainCache.set(n.id,main.id);}else mainCache.set(n.id,'MISSING:'+n.id);}catch{mainCache.set(n.id,'MISSING:'+n.id);}
    }
    for(const field of ['fills','strokes'])for(const p of livePaints(n,field))if(p.type==='SOLID'){
      const id=p.boundVariables?.color?.id;if(id){const v=await variable(id);const old=bindings.get(id);bindings.set(id,{id,name:v?.name||'MISSING',count:(old?.count||0)+1});}else unboundPaints++;
    }
    if(n.type==='INSTANCE'&&n.width<=40&&n.height<=40&&/icon|图标|circle/i.test(n.name)){
      if(!mainCache.has(n.id)){try{mainCache.set(n.id,(await n.getMainComponentAsync())?.id||'MISSING:'+n.id);}catch{mainCache.set(n.id,'MISSING:'+n.id);}}
      icons.push(mainCache.get(n.id));
    }
    if(n.type==='RECTANGLE'&&/hit|热区|点击/i.test(n.name))hitRegions.push({id:n.id,x:n.absoluteBoundingBox&&root.absoluteBoundingBox?n.absoluteBoundingBox.x-root.absoluteBoundingBox.x:n.x,y:n.absoluteBoundingBox&&root.absoluteBoundingBox?n.absoluteBoundingBox.y-root.absoluteBoundingBox.y:n.y,width:n.width,height:n.height,opacity:n.opacity});
  }
  const candidates=nodes.filter(n=>n.width>=root.width*.7&&n.height>=20&&(livePaints(n,'strokes').length||livePaints(n,'fills').length));
  const surface=candidates.find(n=>livePaints(n,'strokes').length)||candidates[0]||null;
  const themes=[];
  for(const T of UXQA_CONFIG.themes){
    const unknown=new Set(),texts=[],visual=[];
    if(!nodes.length)unknown.add('hidden-component:'+root.id);
    for(const n of nodes){
      if(n.opacity===0)continue;
      const paints=[];
      for(const field of ['fills','strokes'])for(const p of livePaints(n,field)){
        if(p.type==='IMAGE')paints.push([field,'IMAGE',p.imageHash,p.opacity]);
        else paints.push([field,await paint(p,T,unknown)]);
      }
      if(Array.isArray(n.effects)&&n.effects.some(e=>e.visible!==false))unknown.add('effects-not-resolved:'+n.id);
      visual.push([n.type,n===root?0:n.x,n===root?0:n.y,n.width,n.height,n.opacity,paints,typeof n.strokeWeight==='number'?n.strokeWeight:null,n.strokeAlign,typeof n.cornerRadius==='number'?n.cornerRadius:null,n.type==='TEXT'?n.characters:null,n.type==='TEXT'&&typeof n.fontName!=='symbol'?n.fontName:null]);
      if(n.type==='TEXT'&&n.characters.trim()){
        const ps=livePaints(n,'fills');let foreground=ps.length===1?await paint(ps[0],T,unknown):null;
        if(ps.length!==1)unknown.add('mixed-text-fill:'+n.id);
        if(foreground)foreground=[foreground[0],foreground[1],foreground[2],foreground[3]*n.opacity];
        const fontSize=typeof n.fontSize==='number'?n.fontSize:null;
        const f=typeof n.fontName==='symbol'?null:n.fontName;
        const bold=f?(typeof f.variationSettings?.wght==='number'?f.variationSettings.wght>=700:/bold|black|heavy/i.test(f.style)&&!/semi|demi/i.test(f.style)):null;
        const inactive=disabledText(n,root);
        texts.push({id:n.id,text:n.characters,foreground,background:inactive?null:await background(n,T,unknown),fontSize,bold,clipped:clipped(n),disabled:inactive});
      }
    }
    let boundary=null;
    if(surface){const ps=livePaints(surface,'strokes');const p=ps.length===1?ps[0]:null;
      boundary={id:surface.id,color:p?await paint(p,T,unknown):null,inside:await background(surface,T,unknown,true),outside:await background(surface,T,unknown),weight:typeof surface.strokeWeight==='number'?surface.strokeWeight:null,align:surface.strokeAlign||'NONE',variables:p?.boundVariables?.color?[p.boundVariables.color.id]:[]};
    }
    themes.push({theme:T.name,appearance:unknown.size?null:fingerprint(JSON.stringify(visual)),texts,boundary,unknown:[...unknown].sort()});
  }
  const skeleton=nodes.map(n=>[n.type,n.layoutMode||null,'children'in n?n.children.filter(x=>x.visible!==false).length:0]);
  components.push({id:root.id,name:root.name,setId:set?set.id:null,setName:set?set.name:root.name,properties:props,width:root.width,height:root.height,disabled,icons:[...new Set(icons)].sort(),hitRegions,themes,structure:{signature:fingerprint(JSON.stringify(skeleton)),nodes:nodes.length,types},dependencies:[...dependencies.values()],fonts:[...fonts].sort(),paintBindings:[...bindings.values()],unboundPaints});
}
return emit({...meta(),kind:'components',inventory:witness(componentIds()),components});
`;
