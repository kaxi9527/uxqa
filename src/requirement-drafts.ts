import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

/** Only interpret field labels in an explicitly labelled record. Prose, tables and lists keep their source wording. */
export function draftPassage(text:string) {
  const fields={actor:'',condition:'',action:'',expected:''};
  const labels:Record<string,keyof typeof fields>={role:'actor',actor:'actor','角色':'actor','参与者':'actor',given:'condition','条件':'condition','前置条件':'condition','前提':'condition',when:'action','操作':'action','动作':'action',then:'expected','预期':'expected','结果':'expected'};
  const parts=text.split(/[；;\n]/).map(part=>part.trim());
  const entries=parts.map(part=>/^([^:：]{1,12})[:：]\s*(.+)$/u.exec(part));
  if(entries.every(entry=>entry && Object.hasOwn(labels,entry[1].trim().toLowerCase()))){
    for(const entry of entries){
      const key=labels[entry![1].trim().toLowerCase()];
      if(fields[key])return {...fields,expected:text,bindingStatus:'needs-binding' as const};
      fields[key]=entry![2].trim();
    }
  } else if(!/^(?:#{1,6}\s|[|:\s-]+$)/.test(text) && /没有|不可|不能|必须|须|应当|应该|支持|允许|禁止|可以|切换|显示|隐藏|提供|创建|分为|分「|无[^\s，。]{1,8}和|\b(?:must|should|cannot|shall|allows?|displays?)\b/i.test(text)){
    fields.expected=text;
  }
  return {...fields,bindingStatus:'needs-binding' as const};
}

export async function inspectRequirements(path:string){
  if(!['.md','.markdown','.txt'].includes(extname(path).toLowerCase()))throw Error('请选择 UTF-8 Markdown 或文本文件 / Choose a Markdown or text document.');
  const info=await stat(path);
  if(!info.isFile()||info.size>8*1024*1024)throw Error('Expected a document up to 8 MiB');
  const bytes=await readFile(path);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const drafts=text.split(/\r?\n/).flatMap((line,i)=>{
    const quote=line.trim();
    if(!quote)return [];
    return [{locator:'L'+(i+1),quote,...draftPassage(quote)}];
  });
  return {document:basename(path),revision:createHash('sha256').update(bytes).digest('hex'),executed:false,drafts};
}
