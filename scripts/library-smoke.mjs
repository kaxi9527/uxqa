import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareComponentPlan, syncComponentPlan } from '../dist/src/library/workflow.js';
import { discoverLibrary } from '../dist/src/library/discovery.js';

const temporary=await mkdtemp(join(tmpdir(),'uxqa-lifecycle-smoke-'));
const product=join(temporary,'product');
const library=join(product,'src/component-library');
const evidence=resolve(`artifacts/library-smoke-${Date.now()}`);
const server=createServer((_request,response)=>response.end('<html><body><main><button onclick="document.querySelector(\'p\').hidden=false">Show</button><p hidden>Record</p></main></body></html>'));
await new Promise((done)=>server.listen(0,'127.0.0.1',done));
try {
  await mkdir(library,{recursive:true});
  await writeFile(join(product,'package.json'),JSON.stringify({name:'example-product',scripts:{test:'node --test check.test.mjs',typecheck:`${JSON.stringify(process.execPath)} ${JSON.stringify(resolve('node_modules/typescript/bin/tsc'))} --noEmit`}}));
  await writeFile(join(product,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'bundler',jsx:'preserve',strict:true,skipLibCheck:true},include:['src/**/*.tsx','src/**/*.d.ts']}));
  await writeFile(join(product,'src/jsx.d.ts'),'declare namespace JSX {interface IntrinsicElements {article: {children?: unknown};} }');
  await writeFile(join(product,'check.test.mjs'),"import {test} from 'node:test';import {strict as assert} from 'node:assert';import {readFileSync} from 'node:fs';test('consumer references shared component',()=>assert.match(readFileSync('src/RecordPage.tsx','utf8'),/component-library\\/RecordCard/));");
  await writeFile(join(library,'component-manifest.json'),'{"owner":"preserve","components":[]}');
  await mkdir(join(product,'qa'));
  await writeFile(join(product,'qa/component.json'),JSON.stringify({baseUrl:`http://127.0.0.1:${server.address().port}`,viewports:[{name:'desktop',width:1200,height:800}],options:{axe:false},flows:[{name:'show record',steps:[{action:'click',target:{role:'button',name:'Show'}},{action:'expectVisible',target:{text:'Record'}}]}]}));
  const definition=JSON.parse(await readFile('examples/component-definition.json','utf8'));
  const definitionPath=join(temporary,'definition.json');await writeFile(definitionPath,JSON.stringify(definition));
  const discovered=await discoverLibrary(product);assert.equal(discovered.status,'found');
  const prepared=await prepareComponentPlan({source:product,definitionPath,outDir:join(evidence,'plan')});
  // Implementation is an explicit product-task step, after library binding.
  await writeFile(join(library,'RecordCard.tsx'),'export function RecordCard({title}: {title:string}) {return <article>{title}</article>;}');
  await writeFile(join(product,'src/RecordPage.tsx'),"import {RecordCard} from './component-library/RecordCard';export const RecordPage=()=> <RecordCard title='Record'/>;");
  const receipt=await syncComponentPlan(prepared.path,join(evidence,'verification'));
  const catalog=JSON.parse(await readFile(receipt.catalog,'utf8'));
  assert.equal(catalog.owner,'preserve');assert.equal(catalog.components[0].name,'RecordCard');
  assert.match(await readFile(receipt.specification,'utf8'),/Accessibility/);
  await writeFile(join(evidence,'native-catalog-readback.json'),JSON.stringify(catalog,null,2));
  await writeFile(join(evidence,'component-spec-readback.md'),await readFile(receipt.specification,'utf8'));
  console.log(JSON.stringify({status:receipt.status,libraryDiscovery:discovered.status,receipt:receipt.receipt,evidence},null,2));
} finally {await new Promise((done)=>server.close(done));await rm(temporary,{recursive:true,force:true});}
