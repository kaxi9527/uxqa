import { ProjectAgentError } from './project-agent.js';
import { storeFrame } from './evidence.js';
import type { ProjectEntry } from './store.js';

async function providerJson(url:string, init:RequestInit) {
  const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(20_000)});
  if (!response.ok) throw new ProjectAgentError(400,'画板服务返回 HTTP '+response.status+'，请核对链接、读取权限和配额。 / Board service returned HTTP '+response.status+'. Check the link, access and quota.');
  return response.json();
}
export async function exportBoard(project:ProjectEntry,input:Record<string,unknown>) {
  let link:URL;
  try { link=new URL(String(input.url)); } catch { throw new ProjectAgentError(400,'无效的画板链接。 / Invalid board URL.'); }
  const token=typeof input.credential==='string'?input.credential.trim():'';
  if(link.protocol!=='https:' || link.username || link.password || !token || /[\r\n]/.test(token)) throw new ProjectAgentError(400,'请输入画板链接及本次读取凭据。 / Enter a board link and a credential for this read.');
  const parts=link.pathname.split('/').filter(Boolean), key=parts[1];
  if (!key || !/^[\w-]+$/.test(key)) throw new ProjectAgentError(400,'请选择具体的设计文件。 / Select a specific design.');
  let imageURL:unknown, label:string, source:string;
  if (['www.figma.com','figma.com'].includes(link.hostname) && ['design','file','proto'].includes(parts[0])) {
    const node=link.searchParams.get('node-id')?.replace(/-/g,':');
    if (!node || !/^\d+:\d+$/.test(node)) throw new ProjectAgentError(400,'请复制 Figma 中具体设计帧的链接。 / Copy a Figma frame link including its node ID.');
    const params=new URLSearchParams({ids:node,format:'png',scale:'1'}), version=link.searchParams.get('version-id');
    if(version) params.set('version',version);
    const output=await providerJson('https://api.figma.com/v1/images/'+key+'?'+params,{headers:{'X-Figma-Token':token}});
    imageURL=output.images?.[node]; label='Figma · '+key+' · '+node;
    source='https://www.figma.com/design/'+key+'?node-id='+encodeURIComponent(node)+(version?'&version-id='+encodeURIComponent(version):'');
  } else if (['www.canva.com','canva.com'].includes(link.hostname) && parts[0]==='design') {
    const page=Number(input.page);
    if(!Number.isSafeInteger(page)||page<1) throw new ProjectAgentError(400,'请输入从 1 开始的页码。 / Enter a page number starting at 1.');
    const headers={authorization:'Bearer '+token,'content-type':'application/json'};
    const base='https://api.canva.com/rest/v1/exports';
    let {job}=await providerJson(base,{method:'POST',headers,body:JSON.stringify({design_id:key,format:{type:'png',pages:[page]}})});
    const id=job?.id;
    if (typeof id!=='string') throw new ProjectAgentError(400,'未取得导出任务。 / No export job returned.');
    for(let i=0;job?.status==='in_progress' && i<20;i++){
      await new Promise(resolve=>setTimeout(resolve,1000));
      ({job}=await providerJson(base+'/'+encodeURIComponent(id),{headers}));
    }
    imageURL=job?.status==='success'?job.urls?.[0]:undefined; label='Canva · '+key+' · p. '+page;
    source='https://www.canva.com/design/'+key+'/view';
  } else throw new ProjectAgentError(400,'此服务可关联链接和本地导出图。 / Attach this board URL to a local export.');
  if (typeof imageURL!=='string' || !imageURL.startsWith('https://')) throw new ProjectAgentError(422,'尚未取得导出图，可改用本地导出。 / No export was returned. Attach a local export.');
  const result=await fetch(imageURL,{signal:AbortSignal.timeout(40_000),redirect:'error'});
  if(!result.ok || !result.body) throw new ProjectAgentError(422,'导出图无法读取。 / Export download unavailable.');
  const chunks:Uint8Array[]=[]; let size=0;
  for await(const chunk of result.body as unknown as AsyncIterable<Uint8Array>) {
    size+=chunk.length;
    if(size>32_000_000) throw new ProjectAgentError(413,'导出超过 32 MB。 / Export exceeds 32 MB.');
    chunks.push(chunk);
  }
  return storeFrame(project,Buffer.concat(chunks),label,input.suites,source);
}
