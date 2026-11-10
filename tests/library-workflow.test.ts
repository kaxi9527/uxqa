import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { prepareComponentPlan, syncComponentPlan } from '../src/library/workflow.js';
import * as catalogs from '../src/library/catalog.js';

async function fixture(root: string, url: string, test = 'node --test component.test.mjs') {
  const product = join(root,'product');
  const library = join(product,'src/component-library');
  await mkdir(library,{recursive:true});
  await writeFile(join(product,'package.json'),JSON.stringify({name:'product-a',scripts:{test,typecheck:'node check.mjs'}}));
  await writeFile(join(product,'component.test.mjs'),"import {test} from 'node:test'; import {strict as assert} from 'node:assert';test('component output',()=>assert.equal(1+1,2));");
  await writeFile(join(product,'check.mjs'),"import {readFileSync} from 'node:fs';if(!readFileSync('src/component-library/RecordCard.tsx','utf8').includes('RecordCard'))process.exit(1);");
  await writeFile(join(library,'component-manifest.json'),JSON.stringify({owner:'keep',components:[{id:'old',name:'Existing'}]}));
  await writeFile(join(library,'RecordCard.tsx'),'export function RecordCard() { return <article>Record</article>; }');
  await writeFile(join(product,'src/Page.tsx'),"import {RecordCard} from './component-library/RecordCard';export const Page = () => <RecordCard/>;");
  await writeFile(join(product,'qa.json'),JSON.stringify({baseUrl:url,viewports:[{name:'desktop',width:1200,height:800}],options:{axe:false},flows:[{name:'show record',steps:[{action:'click',target:{role:'button',name:'Show'}},{action:'expectVisible',target:{text:'Record'}}]}]}));
  const definition = {productId:'product-a',id:'record-card',name:'RecordCard',description:'Record display',
    implementation:['src/component-library/RecordCard.tsx'],consumers:['src/Page.tsx'],states:['default'],variants:['compact'],
    anatomy:['body'],behavior:['show record'],accessibility:['keyboard activation'],usage:['records'],antiUsage:['menus'],
    props:[{name:'children',type:'ReactNode',required:false,description:'Body content'}],
    verification:{testScript:'test',typecheckScript:'typecheck',qaConfig:'qa.json'}};
  const definitionPath=join(root,'definition.json');
  await writeFile(definitionPath,JSON.stringify(definition));
  return {product,library,definitionPath,definition};
}

async function revisionFixture(root:string,url:string,test?:string) {
  const inputs=await fixture(root,url,test);
  const catalog=join(inputs.library,'component-manifest.json');
  const parsed=JSON.parse(await readFile(catalog,'utf8'));
  await mkdir(join(inputs.library,'specs'));
  const spec=join(inputs.library,'specs/record-card.md');
  await writeFile(spec,'Original reviewed specification\n');
  parsed.components.push({...inputs.definition,specification:'specs/record-card.md',status:'old',ownerEvidence:'preserve'});
  await writeFile(catalog,JSON.stringify(parsed));
  await writeFile(inputs.definitionPath,JSON.stringify({...inputs.definition,operation:'revise',description:'Updated record description'}));
  return {...inputs,catalog,spec};
}

describe('explicit existing component revision',()=>{
  it.each([0,999,300001,Infinity,'180000',null,1.5])('refuses invalid process timeout %s',async(value)=>{
    const root=await mkdtemp(join(tmpdir(),'uxqa-revision-timeout-'));
    try{
      const inputs=await revisionFixture(root,'http://127.0.0.1:1');
      const definition=JSON.parse(await readFile(inputs.definitionPath,'utf8'));definition.verification.processTimeoutMs=value;
      await writeFile(inputs.definitionPath,JSON.stringify(definition));
      await expect(prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')})).rejects.toThrow(/processTimeoutMs/);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('retains an explicit bounded timeout and enforces it without writing the catalog',async()=>{
    const root=await mkdtemp(join(tmpdir(),'uxqa-revision-timeout-'));
    try{
      const inputs=await revisionFixture(root,'http://127.0.0.1:1','node -e "setTimeout(()=>{},5000)"');
      const definition=JSON.parse(await readFile(inputs.definitionPath,'utf8'));definition.verification.processTimeoutMs=1000;
      await writeFile(inputs.definitionPath,JSON.stringify(definition));
      const before=await readFile(inputs.catalog,'utf8');
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      expect(plan.plan.definition.verification.processTimeoutMs).toBe(1000);
      await expect(syncComponentPlan(plan.path,join(root,'sync'))).rejects.toThrow(/timed out after 1000ms/);
      expect(await readFile(inputs.catalog,'utf8')).toBe(before);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('preserves identities, unrelated records, metadata and original specification with immutable evidence',async()=>{
    const root=await mkdtemp(join(tmpdir(),'uxqa-revision-'));
    const server=createServer((_req,res)=>res.end('<button onclick="document.querySelector(\'p\').hidden=false">Show</button><p hidden>Record</p>'));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const inputs=await revisionFixture(root,`http://127.0.0.1:${(server.address() as {port:number}).port}`);
      const before=await readFile(inputs.catalog,'utf8');
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      const result=await syncComponentPlan(plan.path,join(root,'sync'));
      const after=JSON.parse(await readFile(inputs.catalog,'utf8'));
      expect(after.components).toHaveLength(2);
      expect(after.components[0]).toEqual(JSON.parse(before).components[0]);
      expect(after.components[1]).toMatchObject({id:'record-card',name:'RecordCard',productId:'product-a',description:'Updated record description',ownerEvidence:'preserve',status:'verified-local'});
      expect(after.components[1]).not.toHaveProperty('operation');
      expect(result.specification).not.toBe(inputs.spec);
      expect(await readFile(inputs.spec,'utf8')).toBe('Original reviewed specification\n');
      expect(await readFile(join(root,'sync/catalog-before.json'),'utf8')).toBe(before);
      expect(JSON.parse(await readFile(result.receipt,'utf8'))).toMatchObject({operation:'revise',previousSpecification:await realpath(inputs.spec),verification:{status:'passed'}});
      await expect(syncComponentPlan(plan.path,join(root,'repeat'))).rejects.toThrow(/changed|stale/);
    } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
  },30_000);

  it.each(['source','spec','catalog','baseline','operation','lock','failed-check'])('blocks %s without changing catalog or original spec',async(kind)=>{
    const root=await mkdtemp(join(tmpdir(),'uxqa-revision-block-'));
    try {
      const inputs=await revisionFixture(root,'http://127.0.0.1:1',kind==='failed-check'?'node -e "process.exit(1)"':undefined);
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      if(kind==='source')await writeFile(join(inputs.product,'src/Page.tsx'),'changed');
      if(kind==='spec')await writeFile(inputs.spec,'user changed spec');
      if(kind==='catalog')await writeFile(inputs.catalog,(await readFile(inputs.catalog,'utf8'))+'\n');
      if(kind==='baseline'){plan.plan.revision!.recordHash='forged';await writeFile(plan.path,JSON.stringify(plan.plan));}
      if(kind==='operation'){delete plan.plan.revision;await writeFile(plan.path,JSON.stringify(plan.plan));}
      if(kind==='lock')await writeFile(join(inputs.library,'.uxqa-sync.lock'),'foreign');
      const catalog=await readFile(inputs.catalog,'utf8'),spec=await readFile(inputs.spec,'utf8');
      await expect(syncComponentPlan(plan.path,join(root,'sync'))).rejects.toThrow();
      expect(await readFile(inputs.catalog,'utf8')).toBe(catalog);
      expect(await readFile(inputs.spec,'utf8')).toBe(spec);
      expect(await readdir(join(inputs.library,'specs'))).toEqual(['record-card.md']);
      if(kind==='lock')expect(await readFile(join(inputs.library,'.uxqa-sync.lock'),'utf8')).toBe('foreign');
    } finally {await rm(root,{recursive:true,force:true});}
  });

  it.each(['missing','ambiguous','product','name','default'])('refuses %s identity or implicit revision',async(kind)=>{
    const root=await mkdtemp(join(tmpdir(),'uxqa-revision-identity-'));
    try {
      const inputs=await revisionFixture(root,'http://127.0.0.1:1');
      const data=JSON.parse(await readFile(inputs.catalog,'utf8'));
      if(kind==='missing')data.components.pop();
      if(kind==='ambiguous')data.components.push({...data.components[1]});
      if(kind==='product')data.components[1].productId='foreign';
      if(kind==='name')data.components[1].name='OtherName';
      if(kind==='default')await writeFile(inputs.definitionPath,JSON.stringify(inputs.definition));
      await writeFile(inputs.catalog,JSON.stringify(data));
      await expect(prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')})).rejects.toThrow();
    } finally {await rm(root,{recursive:true,force:true});}
  });

  it('restores the original catalog after a post-write readback failure',async()=>{
    const root=await mkdtemp(join(tmpdir(),'uxqa-revision-rollback-'));
    const server=createServer((_req,res)=>res.end('<button onclick="document.querySelector(\'p\').hidden=false">Show</button><p hidden>Record</p>'));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const inputs=await revisionFixture(root,`http://127.0.0.1:${(server.address() as {port:number}).port}`);
      const before=await readFile(inputs.catalog,'utf8');
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      const original=catalogs.readCatalog;
      vi.spyOn(catalogs,'readCatalog').mockImplementation(async path=>{const value=await original(path);if(value.source.includes('.revision-'))throw new Error('Injected readback failure');return value;});
      await expect(syncComponentPlan(plan.path,join(root,'sync'))).rejects.toThrow(/readback failure/);
      expect(await readFile(inputs.catalog,'utf8')).toBe(before);
      expect(await readFile(inputs.spec,'utf8')).toBe('Original reviewed specification\n');
      expect(await readdir(join(inputs.library,'specs'))).toEqual(['record-card.md']);
      expect((await readdir(inputs.library)).some(p=>p.includes('.lock')||p.endsWith('.tmp'))).toBe(false);
    } finally {vi.restoreAllMocks();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
  },30_000);
});

describe('componentization library lifecycle', () => {
  it('binds a discovered library first, then verifies and appends specification and catalog with readback', async () => {
    const root=await mkdtemp(join(tmpdir(),'uxqa-sync-'));
    const server=createServer((_request,response)=>{response.end('<html><body><main><button onclick="document.querySelector(\'p\').hidden=false">Show</button><p hidden>Record</p></main></body></html>');});
    await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));
    try {
      const inputs=await fixture(root,`http://127.0.0.1:${(server.address() as {port:number}).port}`);
      const catalog=join(inputs.library,'component-manifest.json');
      const original=await readFile(catalog,'utf8');
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      expect(plan.plan.status).toBe('ready-for-componentization');
      expect(await readFile(catalog,'utf8')).toBe(original);
      const receipt=await syncComponentPlan(plan.path,join(root,'verified'));
      expect(receipt.status).toBe('synced');
      const after=JSON.parse(await readFile(catalog,'utf8'));
      expect(after.owner).toBe('keep');
      expect(after.components[0]).toEqual({id:'old',name:'Existing'});
      expect(after.components[1]).toMatchObject({id:'record-card',name:'RecordCard',status:'verified-local'});
      expect(await readFile(receipt.specification,'utf8')).toContain('ReactNode');
      await expect(syncComponentPlan(plan.path,join(root,'repeat'))).rejects.toThrow(/changed|already/i);
      expect((await readdir(inputs.library)).some((file)=>file.includes('lock'))).toBe(false);
    } finally {await new Promise<void>((resolve)=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
  },30_000);

  it('blocks missing libraries, a different product definition and catalog drift before verification', async () => {
    const root=await mkdtemp(join(tmpdir(),'uxqa-sync-stale-'));
    try {
      const inputs=await fixture(root,'http://127.0.0.1:1');
      await writeFile(inputs.definitionPath,JSON.stringify({...inputs.definition,productId:'other-product'}));
      await expect(prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'wrong')})).rejects.toThrow(/product/i);
      await writeFile(inputs.definitionPath,JSON.stringify(inputs.definition));
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      await writeFile(join(inputs.library,'component-manifest.json'),'{"components":[]}');
      await expect(syncComponentPlan(plan.path,join(root,'verify'))).rejects.toThrow(/changed|stale/i);
      await rm(inputs.library,{recursive:true,force:true});
      await expect(prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'missing')})).rejects.toThrow(/library/i);
    } finally {await rm(root,{recursive:true,force:true});}
  });

  it('does not sync when product checks fail or verification changes component source', async () => {
    const root=await mkdtemp(join(tmpdir(),'uxqa-sync-failure-'));
    try {
      const inputs=await fixture(root,'http://127.0.0.1:1','node -e "process.exit(1)"');
      const original=await readFile(join(inputs.library,'component-manifest.json'),'utf8');
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      await expect(syncComponentPlan(plan.path,join(root,'failed'))).rejects.toThrow(/failed|exited/i);
      expect(await readFile(join(inputs.library,'component-manifest.json'),'utf8')).toBe(original);
      expect(await readdir(inputs.library)).not.toContain('specs');
    } finally {await rm(root,{recursive:true,force:true});}
  });

  it('does not delete an existing component spec when exclusive creation fails', async () => {
    const root=await mkdtemp(join(tmpdir(),'uxqa-existing-spec-'));
    const server=createServer((_request,response)=>{response.end('<html><body><button onclick="document.querySelector(\'p\').hidden=false">Show</button><p hidden>Record</p></body></html>');});
    await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));
    try {
      const inputs=await fixture(root,`http://127.0.0.1:${(server.address() as {port:number}).port}`);
      await mkdir(join(inputs.library,'specs'));
      const spec=join(inputs.library,'specs/record-card.md');
      await writeFile(spec,'Existing user-owned spec');
      const original=await readFile(join(inputs.library,'component-manifest.json'),'utf8');
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      await expect(syncComponentPlan(plan.path,join(root,'verify'))).rejects.toThrow();
      expect(await readFile(spec,'utf8')).toBe('Existing user-owned spec');
      expect(await readFile(join(inputs.library,'component-manifest.json'),'utf8')).toBe(original);
    } finally {await new Promise<void>((resolve)=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
  },30_000);

  it('rejects implementations escaping the library and detects source mutation by a verification script', async () => {
    const root=await mkdtemp(join(tmpdir(),'uxqa-sync-drift-'));
    try {
      const inputs=await fixture(root,'http://127.0.0.1:1');
      await writeFile(inputs.definitionPath,JSON.stringify({...inputs.definition,implementation:['src/Page.tsx']}));
      await expect(prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'escape')})).rejects.toThrow(/inside|library/i);
      await writeFile(inputs.definitionPath,JSON.stringify(inputs.definition));
      await writeFile(join(inputs.product,'check.mjs'),"import {appendFileSync} from 'node:fs';appendFileSync('src/component-library/RecordCard.tsx','\\n//changed');");
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      await expect(syncComponentPlan(plan.path,join(root,'verify'))).rejects.toThrow(/source changed/i);
      expect(JSON.parse(await readFile(join(inputs.library,'component-manifest.json'),'utf8')).components).toHaveLength(1);
    } finally {await rm(root,{recursive:true,force:true});}
  });

  it('blocks undeveloped exports, unused consumers and concurrent native writers', async () => {
    const root=await mkdtemp(join(tmpdir(),'uxqa-sync-preconditions-'));
    try {
      const inputs=await fixture(root,'http://127.0.0.1:1');
      const plan=await prepareComponentPlan({source:inputs.product,definitionPath:inputs.definitionPath,outDir:join(root,'plan')});
      await writeFile(join(inputs.library,'RecordCard.tsx'),'// Candidate only');
      await expect(syncComponentPlan(plan.path,join(root,'undeveloped'))).rejects.toThrow(/not implemented|export/i);
      await writeFile(join(inputs.library,'RecordCard.tsx'),'export function RecordCard() { return <article>Record</article>; }');
      await writeFile(join(inputs.product,'src/Page.tsx'),'export const Page = () => <article>Old local markup</article>;');
      await expect(syncComponentPlan(plan.path,join(root,'unused'))).rejects.toThrow(/consumer/i);
      await writeFile(join(inputs.product,'src/Page.tsx'),"import {RecordCard} from './component-library/RecordCard';export const Page = () => <RecordCard/>;");
      await writeFile(join(inputs.library,'.uxqa-sync.lock'),'other writer');
      await expect(syncComponentPlan(plan.path,join(root,'locked'))).rejects.toThrow(/locked/i);
      expect(await readFile(join(inputs.library,'.uxqa-sync.lock'),'utf8')).toBe('other writer');
    } finally {await rm(root,{recursive:true,force:true});}
  });
});
