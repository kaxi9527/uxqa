import { boundPath, fileHash, hash } from './paths.js';
import { sourceSnapshot } from './snapshot.js';
import type { ComponentPlan, DefinitionInput, NativeCatalog } from './types.js';

// Revisions are deliberately limited to the supported JSON contract. Product
// authorities with their own approval workflow require a dedicated adapter.
export function revisionRecord(catalog:NativeCatalog, definition:DefinitionInput):Record<string,unknown> {
  if(catalog.format!=='json') throw new Error('Revision requires a supported JSON native catalog');
  const entries=JSON.parse(catalog.source).components as Array<Record<string,unknown>>;
  const matches=entries.filter(entry=>entry.id===definition.id || entry.name===definition.name);
  if(matches.length!==1 || matches[0].id!==definition.id || matches[0].name!==definition.name || matches[0].productId!==definition.productId)
    throw new Error('Revision requires one exact existing id/name/product identity');
  if(typeof matches[0].specification!=='string') throw new Error('Revision requires an existing specification');
  return matches[0];
}

export async function revisionBaseline(catalog:NativeCatalog, definition:DefinitionInput, root:string, libraryRoot:string):Promise<NonNullable<ComponentPlan['revision']>> {
  const record=revisionRecord(catalog,definition);
  const specification=await boundPath(libraryRoot,record.specification as string);
  return {recordHash:hash(JSON.stringify(record)),specification,specificationHash:await fileHash(specification),sourceHashes:await sourceSnapshot(root)};
}

export function reviseCatalog(catalog:NativeCatalog, definition:DefinitionInput, specification:string):string {
  const before=revisionRecord(catalog,definition);
  const parsed=JSON.parse(catalog.source);
  const {operation:_operation,...contract}=definition;
  const after={...before,...contract,specification,status:'verified-local'};
  if(!definition.level) delete after.level;
  parsed.components=parsed.components.map((entry:Record<string,unknown>)=>entry.id===definition.id ? after:entry);
  return JSON.stringify(parsed,null,2)+'\n';
}
