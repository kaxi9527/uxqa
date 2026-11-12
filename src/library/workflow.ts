import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { runAudit } from '../runner.js';
import { summarizeRun } from '../report.js';
import { writeReports } from '../report-writer.js';
import { inside, validateSourcePaths } from '../components/source.js';
import { runProcess } from '../components/process.js';
import { appendCatalog, readCatalog } from './catalog.js';
import { loadDefinition } from './definition.js';
import { discoverLibrary } from './discovery.js';
import { boundPath, fileHash, hash } from './paths.js';
import { sourceSnapshot } from './snapshot.js';
import { specification } from './specification.js';
import { verifyImplementation } from './implementation.js';
import { registerExportedScreenshots } from '../ui/exported-screenshot-retention.js';
import { revisionBaseline, reviseCatalog } from './revision.js';
import type { ComponentPlan } from './types.js';

async function emptyOutput(path: string): Promise<void> {
  const entries=await readdir(path).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
  if(entries.length)throw new Error('Output directory contains existing evidence; choose a new directory');
  await mkdir(path,{recursive:true,mode:0o700});
}

export async function prepareComponentPlan(options: {source:string;definitionPath:string;libraryPath?:string;outDir:string}): Promise<{plan:ComponentPlan;path:string}> {
  const discovery=await discoverLibrary(options.source,options.libraryPath);
  if (discovery.status!=='found' || !discovery.library) throw new Error(`Product component library is ${discovery.status}; identify an existing native catalog before componentization`);
  const library=discovery.library;
  const definitionPath=resolve(options.definitionPath);
  const definition=await loadDefinition(definitionPath);
  if (definition.productId!==discovery.productId) throw new Error('Component definition belongs to a different product');
  if (definition.operation!=='revise' && library.entries.some((entry)=>entry.id===definition.id || entry.name===definition.name)) throw new Error('Component already registered; reuse or explicitly revise it');
  const root=discovery.productRoot;
  for (const path of definition.implementation) {
    if (!inside(library.root,resolve(root,path))) throw new Error('Planned implementation must be inside the bound product library');
  }
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  for (const script of [definition.verification.testScript,definition.verification.typecheckScript]) {
    if (typeof pkg.scripts?.[script]!=='string') throw new Error(`Product verification script missing: ${script}`);
  }
  await boundPath(root,definition.verification.qaConfig);
  const validated=await validateSourcePaths(root,options.outDir);
  await emptyOutput(validated.output);
  const plan:ComponentPlan={schemaVersion:1,status:'ready-for-componentization',productId:discovery.productId,productRoot:root,
    source:resolve(options.source),packageHash:await fileHash(join(root,'package.json')),definitionPath,definitionHash:await fileHash(definitionPath),
    definition,library,createdAt:new Date().toISOString(),
    ...(definition.operation==='revise' ? {revision:await revisionBaseline(await readCatalog(library.catalog),definition,root,library.root)}:{})};
  const path=join(validated.output,'component-plan.json');
  await writeFile(path,JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
  const instruction=plan.revision ? `Revise the existing ${definition.name} registration. Implementation is frozen in this revision plan; if source changes, prepare a new plan. Original specification is retained.` : `Implement ${definition.name} in the listed library paths; replace the listed consumers. Reuse existing library tokens and controls.`;
  await writeFile(join(validated.output,'component-plan.md'),`# Componentization Plan\n\nProduct: ${plan.productId}\nLibrary: ${library.root}\nNative catalog: ${library.catalog}\n\n${instruction} Then run uxqa component-sync --plan ${path}.\n\nUnit/typecheck and the configured browser flows must pass on unchanged inputs before catalog/spec sync.\n`,{flag:'wx',mode:0o600});
  await writeFile(join(validated.output,'component-spec-draft.md'),specification(definition,plan.productId),{flag:'wx',mode:0o600});
  return {plan,path};
}

export async function validateComponentPlan(path: string): Promise<ComponentPlan> {
  const plan=JSON.parse(await readFile(path,'utf8')) as ComponentPlan;
  if (plan.schemaVersion!==1 || plan.status!=='ready-for-componentization' || !plan.library) throw new Error('Invalid componentization plan');
  const definition=await loadDefinition(plan.definitionPath);
  if (await fileHash(plan.definitionPath)!==plan.definitionHash || JSON.stringify(definition)!==JSON.stringify(plan.definition)) throw new Error('Component definition changed after the plan; prepare a new plan');
  const discovery=await discoverLibrary(plan.source,plan.library.root);
  if (discovery.status!=='found' || !discovery.library || discovery.productRoot!==plan.productRoot || discovery.productId!==plan.productId ||
      discovery.library.catalog!==plan.library.catalog || discovery.library.catalogHash!==plan.library.catalogHash) throw new Error('Product/library catalog changed or binding is stale');
  if (await fileHash(join(plan.productRoot,'package.json'))!==plan.packageHash) throw new Error('Product package changed after the plan');
  if ((definition.operation==='revise')!==Boolean(plan.revision)) throw new Error('Revision operation/baseline mismatch');
  if (plan.revision && JSON.stringify(await revisionBaseline(await readCatalog(plan.library.catalog),definition,plan.productRoot,plan.library.root))!==JSON.stringify(plan.revision))
    throw new Error('Revision baseline changed: record, original specification or product source drift');
  return plan;
}

export async function syncComponentPlan(planPath: string, outDir: string): Promise<{status:'synced';productId:string;catalog:string;specification:string;receipt:string}> {
  const plan=await validateComponentPlan(planPath);
  const {output}=await validateSourcePaths(plan.productRoot,outDir);
  const root=plan.productRoot;
  for (const path of plan.definition.implementation) {
    const implementation=await boundPath(root,path);
    if (!inside(plan.library.root,implementation)) throw new Error('Implementation is outside the product library');
  }
  for (const path of plan.definition.consumers) await boundPath(root,path);
  await verifyImplementation(plan);
  const qaPath=await boundPath(root,plan.definition.verification.qaConfig);
  const qaSource=await readFile(qaPath,'utf8');
  const qa=loadConfig(JSON.parse(qaSource));
  if (!qa.options.screenshots || !qa.flows.some((flow)=>flow.steps.some((step)=>step.action==='expectVisible'))) throw new Error('Component verification requires a browser flow with an expected visible result and screenshots');
  if (qa.storageState) qa.storageState=await boundPath(root,isAbsolute(qa.storageState) ? qa.storageState:relative(root,resolve(dirname(qaPath),qa.storageState)));
  await emptyOutput(output);
  const lockPath=join(plan.library.root,'.uxqa-sync.lock');
  const lock=await open(lockPath,'wx',0o600).catch(()=>{throw new Error('Library sync is locked by another writer');});
  const lockIdentity=await lock.stat();
  const verification:{checks:Array<{name:string;status:string;log:string}>;status:string;sourceHashes?:Record<string,string>;error?:string}={checks:[],status:'verifying'};
  let tempCatalog:string|undefined;
  let specPath:string|undefined;
  let specCreated=false;
  let committed=false;
  let previousCatalog:string|undefined;
  let updatedCatalog:string|undefined;
  try {
    await validateComponentPlan(planPath);
    const before=await sourceSnapshot(root);
    before['[qa-config]']=await fileHash(qaPath);
    if (before['[qa-config]']!==hash(qaSource)) throw new Error('QA configuration changed before verification');
    if (qa.storageState) before['[auth-state]']=await fileHash(qa.storageState);
    const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
    const manager=typeof pkg.packageManager==='string' && pkg.packageManager.startsWith('pnpm@') ? 'pnpm':'npm';
    for (const script of [plan.definition.verification.testScript,plan.definition.verification.typecheckScript]) {
      const log=join(output,`${script.replace(/[^\w.-]/g,'-')}.log`);
      try {
        const result=await runProcess(manager,['run',script],root,plan.definition.verification.processTimeoutMs);
        await writeFile(log,result.stdout+'\n'+result.stderr,{mode:0o600});
        verification.checks.push({name:script,status:'passed',log});
      } catch (error) {
        await writeFile(log,error instanceof Error ? error.message:String(error),{mode:0o600});
        verification.checks.push({name:script,status:'failed',log});throw error;
      }
    }
    const unchanged=async()=>JSON.stringify(before)===JSON.stringify({...await sourceSnapshot(root),'[qa-config]':await fileHash(qaPath),...(qa.storageState ? {'[auth-state]':await fileHash(qa.storageState)}:{})});
    if (!(await unchanged())) throw new Error('Product source changed during verification; no library sync performed');
    const browserOutput=join(output,'browser');
    let audit;
    try { audit=await runAudit(qa,{outDir:browserOutput}); }
    finally {
      const images=await readdir(browserOutput).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
      await registerExportedScreenshots(browserOutput,images.filter((file)=>file.toLowerCase().endsWith('.png')).map((file)=>join(browserOutput,file)));
    }
    await writeReports(audit,join(output,'browser'));
    if (summarizeRun(audit).status!=='passed' || !audit.artifacts.some((path)=>path.includes('-flow-') && path.endsWith('.png'))) throw new Error('Component browser verification failed or interaction screenshot evidence is missing');
    verification.checks.push({name:'browser',status:'passed',log:join(output,'browser/report.json')});
    if (!(await unchanged())) throw new Error('Product source changed during verification; no library sync performed');
    await validateComponentPlan(planPath);
    const native=await readCatalog(plan.library.catalog);
    const specDirectory=join(plan.library.root,'specs');
    await mkdir(specDirectory,{recursive:true});
    await boundPath(plan.library.root,'specs','directory');
    specPath=join(specDirectory,`${plan.definition.id}${plan.revision ? '.revision-'+randomUUID():''}.md`);
    const spec=specification(plan.definition,plan.productId);
    const updated=plan.revision ? reviseCatalog(native,plan.definition,relative(plan.library.root,specPath)):appendCatalog(native,plan.definition,relative(plan.library.root,specPath));
    if(plan.revision) {
      previousCatalog=native.source;updatedCatalog=updated;
      await writeFile(join(output,'catalog-before.json'),native.source,{flag:'wx',mode:0o600});
      await writeFile(join(output,'specification-before.md'),await readFile(plan.revision.specification),{flag:'wx',mode:0o600});
      await writeFile(join(output,'catalog-after.json'),updated,{flag:'wx',mode:0o600});
    }
    await writeFile(specPath,spec,{flag:'wx',mode:0o600});
    specCreated=true;
    tempCatalog=join(plan.library.root,`.uxqa-${randomUUID()}.tmp`);
    await writeFile(tempCatalog,updated,{flag:'wx',mode:0o600});
    if (await fileHash(native.path)!==native.hash) throw new Error('Native catalog changed before sync');
    await rename(tempCatalog,native.path);tempCatalog=undefined;committed=true;
    const readback=await readCatalog(native.path);
    if (readback.hash!==hash(updated) || readback.entries.length!==native.entries.length+(plan.revision ? 0:1) || !readback.entries.some((entry)=>entry.id===plan.definition.id && entry.name===plan.definition.name) || await fileHash(specPath)!==hash(spec)) throw new Error('Component library sync readback failed');
    if(plan.revision && await fileHash(plan.revision.specification)!==plan.revision.specificationHash) throw new Error('Original specification changed during revision');
    verification.status='passed';verification.sourceHashes=before;
    const receipt=join(output,'sync-receipt.json');
    const result={status:'synced' as const,productId:plan.productId,catalog:native.path,specification:specPath,receipt};
    await writeFile(receipt,JSON.stringify({...result,componentId:plan.definition.id,catalogBefore:native.hash,catalogAfter:readback.hash,
      specificationHash:hash(spec),operation:plan.revision ? 'revise':'register',previousSpecification:plan.revision?.specification,previousSpecificationHash:plan.revision?.specificationHash,
      verification,completedAt:new Date().toISOString(),nativeApproval:plan.library.format==='synnovator-ts' ? 'candidate-needs-evidence':'verified-local'},null,2),{flag:'wx',mode:0o600});
    return result;
  } catch (error) {
    verification.status='failed';verification.error=error instanceof Error ? error.message:String(error);
    // Only restore our exact write. Never overwrite a concurrent foreign change.
    if(committed && previousCatalog!==undefined && updatedCatalog!==undefined) {
      if(await fileHash(plan.library.catalog).catch(()=>undefined)===hash(updatedCatalog)) {
        const rollback=join(plan.library.root,`.uxqa-${randomUUID()}.tmp`);
        await writeFile(rollback,previousCatalog,{flag:'wx',mode:0o600});
        await rename(rollback,plan.library.catalog);committed=false;
      } else verification.error+='; concurrent catalog change prevents automatic rollback; retained recovery evidence';
    }
    await writeFile(join(output,'verification.json'),JSON.stringify(verification,null,2),{mode:0o600});
    if (specCreated && specPath && !committed && await fileHash(specPath).catch(()=>undefined)===hash(specification(plan.definition,plan.productId))) await unlink(specPath).catch(()=>{});
    throw new Error(`${verification.error}; verification evidence: ${output}`);
  } finally {
    if (tempCatalog) await unlink(tempCatalog).catch(()=>{});
    await lock.close();
    const currentLock=await lstat(lockPath).catch(()=>undefined);
    if (currentLock?.ino===lockIdentity.ino) await unlink(lockPath);
  }
}
