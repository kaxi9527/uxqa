import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { link, lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unpackCapture } from './transport.js';
import { validateChunk, validateIndex } from './validate.js';
import { validateGraph } from './graph.js';
import type { FigmaIndex } from './types.js';

const limit=64*1024*1024;
const sha=(data:string)=>createHash('sha256').update(data).digest('hex');
export async function captureInput(source:string,clipboard:boolean) {
  let text:string;
  if(clipboard){
    const programs=process.platform==='darwin'?[['pbpaste']]:process.platform==='win32'?[['powershell.exe','-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-Clipboard -Raw']]:[['wl-paste','--no-newline'],['xclip','-selection','clipboard','-o']];
    let found:string|undefined;
    for(const [cmd,...args] of programs)try{found=(await promisify(execFile)(cmd,args,{maxBuffer:limit,timeout:10000})).stdout;break;}catch{}
    if(found===undefined)throw new Error('Cannot read clipboard; pass saved JSON with --from <file> or --from -');text=found;
  }else if(source==='-'){
    const buffers:Buffer[]=[];let bytes=0;
    for await(const block of process.stdin){const b=Buffer.from(block);bytes+=b.length;if(bytes>limit)throw new Error('Capture exceeds 64 MiB');buffers.push(b);}
    text=Buffer.concat(buffers).toString('utf8');
  }else{
    const s=await lstat(source);if(!s.isFile()||s.size>limit)throw new Error('Expected a regular capture file up to 64 MiB');text=await readFile(source,'utf8');
  }
  let raw=JSON.parse(text.trim());
  if(raw?.isError)throw new Error('MCP returned an error, not a capture');
  if(raw?.structuredContent?.kind||raw?.structuredContent?.encoding)raw=raw.structuredContent;
  else if(Array.isArray(raw?.content)){
    const values=raw.content.filter((b:{type?:string})=>b.type==='text').map((b:{text:string})=>{try{return JSON.parse(b.text);}catch{return null;}}).filter((v:{kind?:string;encoding?:string}|null)=>v?.kind||v?.encoding);
    if(values.length!==1)throw new Error('Expected exactly one JSON capture in the MCP result');raw=values[0];
  }
  return unpackCapture(raw);
}

async function existing(path:string):Promise<string|undefined>{
  try{const s=await lstat(path);if(!s.isFile()||s.size>64*1024*1024)throw new Error('Invalid existing capture file');return await readFile(path,'utf8');}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}
}

export async function ingestCapture(raw:unknown,out:string) {
  const value=raw as {kind?:string;index?:unknown;chunks?:unknown[];graph?:unknown};
  const bundle=value?.kind==='qa-master-figma-capture';
  if(bundle&&(!Array.isArray(value.chunks)||value.chunks.length>500||!value.graph))throw new Error('Invalid capture bundle');
  if(!bundle&&!['index','components','prototype'].includes(value?.kind??''))throw new Error('Unknown capture kind');
  await mkdir(out,{recursive:true,mode:0o700});
  const files=new Map<string,string>();
  const put=(name:string,data:unknown)=>files.set(name,JSON.stringify(data)+'\n');
  const prior=await existing(join(out,'index.json'));let index:FigmaIndex|undefined=prior?validateIndex(JSON.parse(prior)):undefined;
  if(bundle||value.kind==='index'){
    index=validateIndex(bundle?value.index:value);put('index.json',index);
    const previousGraph=await existing(join(out,'prototype.json'));
    if(previousGraph){const graph=validateGraph(JSON.parse(previousGraph));if((['fileKey','pageId','exportId'] as const).some(k=>graph[k]!==index![k]))throw new Error('Existing prototype belongs to another capture');}
    put('index.receipt.json',{exportId:index.exportId,sha256:sha(files.get('index.json')!)});
  }
  const chunks=bundle?value.chunks!:value.kind==='components'?[value]:[];
  const ids=new Map<string,string>();
  if(chunks.length){
    if(!index)throw new Error('Ingest the original index first');
    for(const name of (await readdir(out)).filter(n=>/^chunk-[\w-]+\.json$/.test(n))){
      const chunk=validateChunk(unpackCapture(JSON.parse((await existing(join(out,name)))!)),index);
      for(const c of chunk.components)ids.set(c.id,name);
    }
    for(const part of chunks){
      const chunk=validateChunk(unpackCapture(part),index);
      if(!chunk.components.length)throw new Error('Empty component batch');
      const name='chunk-'+sha(JSON.stringify(chunk.components.map(c=>c.id).sort())).slice(0,24)+'.json';
      if(files.has(name))throw new Error('Duplicate component batch in bundle');
      for(const c of chunk.components){if(ids.has(c.id)&&ids.get(c.id)!==name)throw new Error('Overlapping batches: '+c.id);ids.set(c.id,name);}
      put(name,chunk);
    }
  }
  if(bundle||value.kind==='prototype'){
    const graph=validateGraph(bundle?value.graph:value);
    if(index&&(['fileKey','pageId','exportId'] as const).some(k=>graph[k]!==index![k]))throw new Error('Prototype and index scope mismatch');
    put('prototype.json',graph);
  }
  for(const [name,data] of files){const old=await existing(join(out,name));if(old!==undefined&&old!==data)throw new Error('Existing evidence differs: '+name);}
  for(const [name,data] of files){
    const target=join(out,name);if(await existing(target)===data)continue;
    const tmp=join(out,'.ingest-'+randomUUID());
    try{await writeFile(tmp,data,{mode:0o600,flag:'wx'});await link(tmp,target);}
    catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||await existing(target)!==data)throw e;}
    finally{await unlink(tmp).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});}
  }
  return [...files.keys()];
}

export const PLUGIN_UI=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>QA Master · Figma</title>
<style>body{font:14px system-ui;padding:12px;color:#242235}button,a{font:inherit;margin:4px;padding:7px}p{overflow-wrap:anywhere}</style>
<button data-run="all">采集主件与原型 / Capture page</button><button data-run="graph">仅原型 / Prototype only</button>
<p role="status">读取当前配置指定的页面，保存为本地 JSON。 / Save a local JSON capture.</p><a hidden>下载采集文件 / Download capture</a>
<script>const statusEl=document.querySelector('p'),save=document.querySelector('a'),buttons=[...document.querySelectorAll('button')];let url;
for(const b of buttons)b.onclick=()=>{buttons.forEach(x=>x.disabled=true);save.hidden=true;statusEl.textContent='采集中 / Capturing…';parent.postMessage({pluginMessage:b.dataset.run},'*')};
onmessage=e=>{if(e.source!==parent)return;const m=e.data.pluginMessage;if(!m)return;if(m.progress){statusEl.textContent=m.progress;return}
buttons.forEach(x=>x.disabled=false);if(m.error){statusEl.textContent=m.error;return}
if(m.done){if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([JSON.stringify(m.done)],{type:'application/json'}));save.href=url;save.download='qa-master-'+(m.done.index||m.done).exportId+'.json';save.hidden=false;statusEl.textContent='采集完成，请下载后运行 uxqa figma ingest。 / Ready to download.'}};</script></html>`;
