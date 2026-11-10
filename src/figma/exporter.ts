import type { FigmaConfig } from './types.js';

/** Generated code only reads document nodes/variables. Page selection is the sole UI operation. */
export function exportScripts(config: FigmaConfig, exportId: string): { index: string; collect: string } {
  const prefix = `const UXQA_CONFIG = ${JSON.stringify(config)};\nconst UXQA_EXPORT_ID = ${JSON.stringify(exportId)};\n`;
  const setup = String.raw`
if (figma.fileKey && figma.fileKey !== UXQA_CONFIG.fileKey) throw Error('UXQA file scope mismatch');
const page = await figma.getNodeByIdAsync(UXQA_CONFIG.pageId);
if (!page || page.type !== 'PAGE') throw Error('UXQA page not found');
await figma.setCurrentPageAsync(page);
const meta = () => ({schemaVersion:1,exportId:UXQA_EXPORT_ID,fileKey:UXQA_CONFIG.fileKey,pageId:page.id,capturedAt:new Date().toISOString()});
const byteLength=s=>encodeURIComponent(s).replace(/%[0-9A-F]{2}/g,'x').length;
const bounded = value => {const s=JSON.stringify(value);if(byteLength(s)<=38000)return value;
  const counts=new Map(),tokens=s.match(/"(?:\\.|[^"\\])*"/g)||[];for(const token of tokens)counts.set(token,(counts.get(token)||0)+1);
  const dictionary=[],refs=new Map();for(const [token,count]of counts)if(token.length>7&&count>1){refs.set(token,dictionary.length);dictionary.push(JSON.parse(token));}
  const payload=s.replace(/"(?:\\.|[^"\\])*"/g,token=>refs.has(token)?'@'+refs.get(token):token);
  const packed={encoding:'uxqa-json-dictionary-v1',dictionary,payload};
  if(byteLength(JSON.stringify(packed))>43000)throw Error('UXQA output exceeds 43000 bytes; reduce component IDs and retry (nothing was changed)');return packed;};
`;
  const index = prefix + setup + String.raw`
const ids = page.findAllWithCriteria({types:['COMPONENT']}).map(n=>n.id).sort();
async function tokenColor(id,theme,chain=[]){if(chain.includes(id)||chain.length>20)return null;const v=await figma.variables.getVariableByIdAsync(id);if(!v)return null;const c=await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);if(!c)return null;const mode=c.modes.find(m=>m.name.toLowerCase()===theme.toLowerCase())||(c.modes.length===1?c.modes[0]:null);if(!mode)return null;const x=v.valuesByMode[mode.modeId];if(x?.type==='VARIABLE_ALIAS')return tokenColor(x.id,theme,[...chain,id]);return x&&typeof x.r==='number'?[x.r,x.g,x.b,x.a===undefined?1:x.a]:null;}
const tokenObservations=[];for(const t of UXQA_CONFIG.tokenExpectations||[])tokenObservations.push({...t,actual:await tokenColor(t.id,t.theme)});
return bounded({...meta(),kind:'index',pageName:page.name,componentIds:ids,themes:UXQA_CONFIG.themes.map(t=>t.name),forbiddenFonts:UXQA_CONFIG.forbiddenFonts||[],allowedColorPrefixes:UXQA_CONFIG.allowedColorPrefixes||[],tokenObservations});
`;
  const collect = prefix + 'const UXQA_IDS = []; // Replace only this ID array with a bounded batch from index.json.\n' + setup + COLLECT;
  return { index, collect };
}

const COLLECT = String.raw`
if (!UXQA_IDS.length || UXQA_IDS.length>30 || new Set(UXQA_IDS).size!==UXQA_IDS.length) throw Error('UXQA needs 1–30 unique component IDs');
const variableCache=new Map(),collectionCache=new Map(),mainCache=new Map();
const variable=async id=>{if(!variableCache.has(id))variableCache.set(id,await figma.variables.getVariableByIdAsync(id));return variableCache.get(id);};
const collection=async id=>{if(!collectionCache.has(id))collectionCache.set(id,await figma.variables.getVariableCollectionByIdAsync(id));return collectionCache.get(id);};
const rgba=c=>[c.r,c.g,c.b,c.a===undefined?1:c.a];
const composite=(f,b)=>[f[0]*f[3]+b[0]*(1-f[3]),f[1]*f[3]+b[1]*(1-f[3]),f[2]*f[3]+b[2]*(1-f[3]),1];
async function resolveColor(id,T,unknown,chain=[]) {
  if(chain.includes(id)||chain.length>20){unknown.add('alias-cycle:'+id);return null;}
  const v=await variable(id);if(!v){unknown.add('missing-variable:'+id);return null;}
  const c=await collection(v.variableCollectionId);if(!c){unknown.add('missing-collection:'+v.variableCollectionId);return null;}
  const mode=c.modes.find(m=>m.name.toLowerCase()===T.name.toLowerCase())||(c.modes.length===1?c.modes[0]:null);
  if(!mode){unknown.add('missing-theme:'+c.id+':'+T.name);return null;}
  const value=v.valuesByMode[mode.modeId];
  if(value&&value.type==='VARIABLE_ALIAS')return resolveColor(value.id,T,unknown,[...chain,id]);
  if(!value||typeof value.r!=='number'){unknown.add('non-color-variable:'+id);return null;}
  return rgba(value);
}
async function paint(p,T,unknown) {
  if(p.type!=='SOLID'){unknown.add('unsupported-paint:'+p.type);return null;}
  if(p.boundVariables&&p.boundVariables.color)return resolveColor(p.boundVariables.color.id,T,unknown);
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
  if(props&&Object.entries(props).some(([k,raw])=>{const v=raw&&typeof raw==='object'?raw.value:raw;return /disabled|禁用/i.test(k)?/^(true|disabled|禁用)$/i.test(String(v)):/^(state|状态)$/i.test(k)&&/^(disabled|禁用)$/i.test(String(v));}))return true;
}return false;}
function fingerprint(s){let a=2166136261,b=5381;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return (a>>>0).toString(16)+'-'+(b>>>0).toString(16)+':'+s.length;}
const components=[];
for(const id of UXQA_IDS){
  const root=await figma.getNodeByIdAsync(id);if(!root||root.type!=='COMPONENT')throw Error('Not a component: '+id);
  let ancestor=root;while(ancestor&&ancestor.type!=='PAGE')ancestor=ancestor.parent;
  if(!ancestor||ancestor.id!==page.id)throw Error('Component outside requested page: '+id);
  const set=root.parent&&root.parent.type==='COMPONENT_SET'?root.parent:null;
  const props=root.variantProperties||{},nodes=[];walk(root,nodes);
  const disabled=Object.entries(props).some(([k,v])=>/disabled|禁用/i.test(k)?/true|disabled|禁用/i.test(v):/^(state|状态)$/i.test(k)&&/disabled|禁用/i.test(v));
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
        texts.push({id:n.id,text:n.characters,foreground,background:await background(n,T,unknown),fontSize,bold,clipped:clipped(n),disabled:disabledText(n,root)});
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
return bounded({...meta(),kind:'components',components});
`;
