import { readFile } from 'node:fs/promises';
import { productRelativePath } from './paths.js';
import type { DefinitionInput } from './types.js';

function text(value: unknown, label: string): string {
  if (typeof value!=='string' || !value.trim() || value.length>10_000) throw new Error(`${label} must be non-empty text`);
  return value;
}
function list(value: unknown, label: string, required = true): string[] {
  if (!Array.isArray(value) || value.length>100 || (required && !value.length)) throw new Error(`${label} must be a bounded list`);
  return value.map((entry) => text(entry,label));
}

export async function loadDefinition(path: string): Promise<DefinitionInput> {
  const raw=await readFile(path,'utf8');
  if (raw.length>200_000) throw new Error('Component definition exceeds 200 KB');
  const value=JSON.parse(raw);
  if (!value || typeof value!=='object' || !value.verification) throw new Error('Component definition requires verification');
  if (value.operation!==undefined && value.operation!=='revise') throw new Error('Unsupported component operation');
  const id=text(value.id,'id');
  const name=text(value.name,'name');
  if (!/^[a-z0-9][a-z0-9._-]{0,100}$/.test(id)) throw new Error('Component id must use lowercase letters, numbers, dots, underscores or hyphens');
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error('Component name must be a PascalCase identifier');
  if (!Array.isArray(value.props) || value.props.length>100) throw new Error('props must be a list');
  if (value.level && !['atom','atom-group','atom-group-set','page-pattern'].includes(value.level)) throw new Error('Unsupported component level');
  const props=value.props.map((prop: Record<string,unknown>)=>{
    if (!prop || typeof prop.required!=='boolean') throw new Error('Component props need required boolean');
    return {name:text(prop.name,'prop.name'),type:text(prop.type,'prop.type'),description:text(prop.description,'prop.description'),required:prop.required,
      ...(prop.default===undefined ? {}:{default:text(prop.default,'prop.default')})};
  });
  if (new Set(props.map((prop: {name:string})=>prop.name)).size!==props.length) throw new Error('Duplicate component props');
  const testScript=text(value.verification.testScript,'verification.testScript');
  const typecheckScript=text(value.verification.typecheckScript,'verification.typecheckScript');
  const processTimeoutMs=value.verification.processTimeoutMs;
  if(processTimeoutMs!==undefined && (!Number.isInteger(processTimeoutMs) || processTimeoutMs<1000 || processTimeoutMs>300_000)) throw new Error('processTimeoutMs must be an integer from 1000 to 300000');
  if (testScript===typecheckScript) throw new Error('Test and typecheck scripts must be distinct');
  for (const script of [testScript,typecheckScript]) if (!/^[\w:.-]+$/.test(script)) throw new Error('Invalid verification script name');
  return {id,name,productId:text(value.productId,'productId'),description:text(value.description,'description'),props,
    ...(value.operation ? {operation:'revise' as const}:{}),
    implementation:list(value.implementation,'implementation').map((entry)=>productRelativePath(entry,'implementation')),
    consumers:list(value.consumers,'consumers').map((entry)=>productRelativePath(entry,'consumer')),
    anatomy:list(value.anatomy,'anatomy'),behavior:list(value.behavior,'behavior'),accessibility:list(value.accessibility,'accessibility'),
    states:list(value.states,'states'),variants:list(value.variants,'variants',false),usage:list(value.usage,'usage'),antiUsage:list(value.antiUsage,'antiUsage',false),
    ...(value.level ? {level:value.level}:{}),verification:{testScript,typecheckScript,qaConfig:productRelativePath(value.verification.qaConfig,'qaConfig'),...(processTimeoutMs===undefined ? {}:{processTimeoutMs})}};
}
