import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assuranceCatalog } from '../guidance/assurance.js';
import { pullGitLibrary } from '../inventory/sources.js';
import { listProductFiles, scanFile } from '../check/scan.js';
import { HINT_RULES } from '../check/hints.js';
import { ENGLISH_HINTS } from '../check/hints.en.js';
import { dataDir, type ProjectEntry } from './store.js';
import { ProjectAgentError } from './project-agent.js';

export interface Passage { locator: string; text: string }
interface Source {
  id: string; name: string; kind: 'text'|'image'|'link'|'repository'|'design'; suites: string[];
  format: string; revision: string; passages: Passage[]; gaps: string[]; at: string; url?: string; image?: string;
  diagnostics?: {rule:string; location:string; zh:string; en:string}[];
}
const categories = new Set(assuranceCatalog(null).map(x => x.id));
const digest = (data: string|Buffer) => createHash('sha256').update(data).digest('hex');
const directory = (project: ProjectEntry) => join(dataDir(), 'projects', project.id, 'assurance', 'sources');
function invalid(message: string): never { throw new ProjectAgentError(400, message); }
function suites(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || !value.every(v => typeof v === 'string' && categories.has(v))) invalid('请选择检测类别。 / Select applicable checks.');
  return [...new Set(value)].sort();
}
function webLink(input: unknown) {
  let url: URL;
  try { url = new URL(String(input)); } catch { return invalid('需要完整的 HTTPS 链接。 / Enter a full HTTPS URL.'); }
  const localHost=/^(?:localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[\w.-]+\.local)$/i.test(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol==='http:' && localHost)) || url.username || url.password || [...url.searchParams.keys()].some(k => /token|secret|password|signature/i.test(k))) invalid('请使用无凭据的 HTTPS 或局域网 HTTP 地址。 / Use HTTPS or a local-network HTTP URL without credentials.');
  return url;
}
function summary({passages,...source}: Source) { return {...source, count: passages.length}; }
export async function listEvidence(project: ProjectEntry) {
  const dir = join(directory(project),'index');
  const names = await readdir(dir).catch((e:NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
  const result = await Promise.all(names.filter(n=>n.endsWith('.json')).map(async n => JSON.parse(await readFile(join(dir,n),'utf8')) as ReturnType<typeof summary>));
  return result.sort((a,b)=>b.at.localeCompare(a.at));
}
export async function readEvidence(project: ProjectEntry, id: unknown): Promise<Source> {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) invalid('无效的依据编号。 / Invalid source ID.');
  return JSON.parse(await readFile(join(directory(project),id+'.json'),'utf8').catch((e:NodeJS.ErrnoException) => { if (e.code === 'ENOENT') throw new ProjectAgentError(404,'找不到此项目依据。 / Project source unavailable.'); throw e; }));
}
async function store(project: ProjectEntry, input: Omit<Source,'id'|'at'>) {
  const id = digest(JSON.stringify([input.kind,input.name,input.revision,input.url,input.suites]));
  const dir = directory(project); await mkdir(dir,{recursive:true,mode:0o700});
  const source = {...input, id, at:new Date().toISOString()};
  const temp = join(dir,randomUUID()+'.tmp');
  await writeFile(temp,JSON.stringify(source),{mode:0o600});
  await rename(temp,join(dir,id+'.json'));
  const index=join(dir,'index');await mkdir(index,{recursive:true,mode:0o700});
  const meta=summary(source), staged=join(index,randomUUID()+'.tmp');
  await writeFile(staged,JSON.stringify(meta),{mode:0o600});
  await rename(staged,join(index,id+'.json'));
  return meta;
}
export async function evidenceImage(project: ProjectEntry, id: string) {
  const item = await readEvidence(project,id);
  if (!item.image) invalid('请关联已导出的画面。 / Attach a rendered frame.');
  return {item, bytes:await readFile(join(directory(project),item.image+'.png'))};
}
export async function storeFrame(project:ProjectEntry, bytes:Buffer, name:string, selected:unknown, origin?:string) {
  const selectedSuites=suites(selected);
  if (!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) || bytes.length < 33 || bytes.length > 32_000_000 || bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16_000_000) invalid('设计画面需为 16 MP 以内、32 MB 以内的 PNG。 / Choose a PNG up to 16 MP and 32 MB.');
  const revision = digest(bytes), dir = directory(project);
  await mkdir(dir,{recursive:true,mode:0o700});
  await writeFile(join(dir,revision+'.png'),bytes,{flag:'wx',mode:0o600}).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST') throw e;});
  return store(project,{name,kind:'image',format:'PNG',image:revision,revision,passages:[],gaps:[],suites:selectedSuites,...(origin ? {url:webLink(origin).href}: {})});
}
export async function importEvidence(project: ProjectEntry, input: Record<string,unknown>) {
  const selected = suites(input.suites), name = typeof input.name==='string' ? input.name.trim() : '';
  if (!name || name.length>500) invalid('请填写资料名称。 / Enter a source name.');
  if (input.kind==='link') {
    const url=webLink(input.url).href;
    return store(project,{name,kind:'link',url,revision:'',format:'URL',passages:[],gaps:[],suites:selected});
  }
  if (input.kind==='image' && typeof input.png==='string') return storeFrame(project,Buffer.from(input.png,'base64'),name,selected,typeof input.url==='string'?input.url:undefined);
  if (!['text','design'].includes(String(input.kind)) || typeof input.revision!=='string' || !/^[a-f0-9]{64}$/.test(input.revision) ||
    typeof input.format!=='string' || !/^[a-z0-9]{1,12}$/i.test(input.format) || !Array.isArray(input.passages) ||
    !input.passages.every(p=>p && typeof p.text==='string' && p.text.trim() && p.text.length<=4000 && typeof p.locator==='string' && p.locator.length>0 && p.locator.length<=500) ||
    !Array.isArray(input.gaps) || !input.gaps.every(g=>typeof g==='string' && g.length<=500)) invalid('提取的文档格式无效。 / Invalid document extract.');
  if(Buffer.byteLength(JSON.stringify(input))>8_000_000) invalid('提取文本超过 8 MB。 / Extract exceeds 8 MB.');
  return store(project,{name,kind: input.kind==='design'?'design':'text',format:input.format,revision:input.revision,passages:input.passages,gaps:input.gaps,suites:selected});
}
export async function inspectRemoteCode(project: ProjectEntry,input:Record<string,unknown>) {
  const url=webLink(input.url), selected=suites(input.suites), ref=typeof input.ref==='string'?input.ref.trim():'';
  if (url.search || url.hash || !url.pathname.slice(1) || (ref && (!/^[\w./-]+$/.test(ref)||ref.startsWith('-')))) invalid('请输入仓库克隆地址和有效分支。 / Enter the repository clone URL and a valid ref.');
  const cacheScope = join(directory(project),'repositories',digest(ref || 'HEAD'));
  const {dir,commit} = await pullGitLibrary(cacheScope,{name:url.hostname,git:url.href,ref:ref || undefined});
  const files = await listProductFiles(dir), passages:Passage[] = [], gaps:string[] = [], diagnostics:NonNullable<Source['diagnostics']>=[];
  let scanned=0, observations=0;
  for (const file of files) {
    const result=await scanFile(dir,file);
    if (result.parseError) { if (gaps.length<30) gaps.push(result.file+' · '+result.parseError); continue; }
    scanned++;
    for (const obs of result.observations) {
      observations++;
      if(obs.kind==='hint' && diagnostics.length<500){
        const rule=HINT_RULES[obs.check];
        diagnostics.push({rule:rule.id,location:result.file+':'+obs.line,zh:rule.name(obs),en:ENGLISH_HINTS[obs.check]});
      }
      if (passages.length<500 && obs.snippet) passages.push({locator:result.file+':'+obs.line,text:(obs.kind==='hint'?obs.check:obs.kind)+' · '+obs.snippet});
    }
  }
  if (observations>passages.length) gaps.push('仅列出前 500 项源码观察。 / Showing the first 500 source observations.');
  const name=url.hostname+url.pathname;
  return store(project,{kind:'repository',name,revision:commit,format:'Git',url:url.href,passages,diagnostics,gaps:[scanned+' files · '+observations+' observations',...gaps],suites:selected});
}
export async function readCodeLink(project:ProjectEntry,input:Record<string,unknown>) {
  const selected=suites(input.suites), origin=webLink(input.url), target=new URL(origin);
  const github=/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(origin.pathname);
  if(origin.hostname==='github.com' && github){target.hostname='raw.githubusercontent.com';target.pathname='/'+github[1]+'/'+github[2]+'/'+github[3];target.search='';}
  if(origin.hostname==='gitlab.com') target.pathname=target.pathname.replace('/-/blob/','/-/raw/');
  target.hash='';
  const result=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(25_000)});
  if(!result.ok || !result.body) throw new ProjectAgentError(422,'源码读取失败 / Source unavailable · HTTP '+result.status);
  if(!/^(?:text\/(?!html)|application\/(?:json|javascript|xml|yaml|octet-stream))/i.test(result.headers.get('content-type') || '')) invalid('链接需要指向原始文本文件。 / Use a raw text file link.');
  const chunks:Uint8Array[]=[]; let size=0;
  for await (const chunk of result.body as unknown as AsyncIterable<Uint8Array>) {
    size+=chunk.length;if(size>2_000_000) invalid('链接文本上限为 2 MB。 / Remote text limit is 2 MB.');chunks.push(chunk);
  }
  const bytes=Buffer.concat(chunks);
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return invalid('需要 UTF-8 文本。 / UTF-8 text is required.');}
  if(text.includes('\0') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(text) && !/\.html?$/i.test(target.pathname)) invalid('返回内容不是原始代码。 / The response is not a raw source file.');
  const passages:Passage[]=[];
  text.split(/\r\n|\r|\n/).forEach((line,i)=>{for(let j=0;j<line.length;j+=4000){const excerpt=line.slice(j,j+4000).trim();if(excerpt)passages.push({locator:'L'+(i+1),text:excerpt});}});
  return store(project,{kind:'text',name:origin.hostname+origin.pathname,revision:digest(bytes),format:'URL',url:origin.href,passages,gaps:[],suites:selected});
}
