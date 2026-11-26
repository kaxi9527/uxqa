import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { runCheck } from '../src/check/run.js';
import { startConsole } from '../src/ui/server.js';
import { addProject, newRoundId, saveRound, shotsDir, updateProject } from '../src/ui/store.js';
import { writeAiSettings } from '../src/ai/model.js';

it('replays a saved interaction on the original route and refreshes after navigating away', async () => {
  const prior=process.env.UXQA_HOME,temp=await mkdtemp(join(tmpdir(),'uxqa-sample-replay-'));
  process.env.UXQA_HOME=join(temp,'data');
  let release: (()=>void)|undefined, pause:Promise<void>|undefined;
  const preview=createServer(async (req,res)=>{
    if (req.url==='/items') {if(pause)await pause;res.end('ready');return;}
    res.setHeader('content-type','text/html;charset=utf-8');
    res.end('<html lang="en"><title>Sample</title><main><h1>Items</h1><p id="error" hidden>Offline</p><p id="items" hidden>Ready</p><button id="retry">Retry</button></main><script>async function load(){const r=await fetch("/items");error.hidden=r.ok;items.hidden=!r.ok}retry.onclick=load;load()</script></html>');
  });
  let app:Awaited<ReturnType<typeof startConsole>>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try {
    await mkdir(process.env.UXQA_HOME);await writeFile(join(process.env.UXQA_HOME,'access-settings.json'),JSON.stringify({locale:'en',onboardingDone:true,checks:[]}));
    const root=join(temp,'sample');await mkdir(root);await writeFile(join(root,'package.json'),'{"name":"sample"}');
    await writeFile(join(root,'View.tsx'),'export const View=()=> <main>Items</main>');
    const project=await addProject(root,'Sample');await saveRound(project.id,await runCheck({source:root}));
    await new Promise<void>(resolve=>preview.listen(0,'127.0.0.1',resolve));
    const address=preview.address();if(!address || typeof address==='string')throw new Error('Missing preview port');
    await updateProject(project.id,{pages:{baseUrl:'http://127.0.0.1:'+address.port,routes:['/'],discover:false}});
    app=await startConsole({port:0});browser=await chromium.launch();const page=await browser.newPage(),url=new URL(app.url);
    url.searchParams.set('project',project.id);await page.goto(url.href);
    await page.getByLabel('Check category').selectOption('interaction');
    const picker=page.getByLabel('Built-in interaction scenario'),route=page.getByLabel('Page route to sample');
    await route.fill('/draft');await picker.selectOption('failure-recovery');
    await page.getByLabel('GET request URL pattern').fill('**/items');await page.getByLabel('Error message',{exact:true}).fill('#error');
    await page.getByLabel('Recovered content').fill('#items');await page.getByLabel('Retry button',{exact:false}).fill('#retry');
    await page.getByRole('button',{name:'Run page sample'}).click();
    const records=page.locator('summary[data-sample-result]');
    await records.first().waitFor();expect(await records.first().textContent()).toContain('/draft');
    expect(await picker.inputValue()).toBe('failure-recovery');expect(await route.inputValue()).toBe('/draft');
    await records.first().click();pause=new Promise<void>(resolve=>{release=resolve;});
    await page.getByRole('button',{name:'Rerun with these settings'}).click();
    await page.getByRole('tab',{name:'Workflow',exact:true}).click();await page.getByRole('tab',{name:'Check',exact:true}).click();
    await page.getByText('A sample is running. Results will appear automatically.').waitFor();
    release!();
    await records.nth(1).waitFor({timeout:45000});
    expect(await records.first().textContent()).toContain('/draft · Recover after a failure · Pass');
    expect(await page.getByLabel('Error message',{exact:true}).inputValue()).toBe('#error');
    expect(await page.getByRole('button',{name:'Run page sample'}).isEnabled()).toBe(true);
  } finally {release?.();await browser?.close();await app?.close();await new Promise<void>(done=>preview.close(()=>done()));
    if(prior===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=prior;await rm(temp,{recursive:true,force:true});}
},90000);

it('links a development contract, runs a grounded scenario and compares original design pixels with an observed round', async () => {
  const prior = process.env.UXQA_HOME, temp = await mkdtemp(join(tmpdir(), 'uxqa-assurance-'));
  process.env.UXQA_HOME = join(temp,'home');
  await mkdir(process.env.UXQA_HOME);
  await writeFile(join(process.env.UXQA_HOME, 'access-settings.json'), JSON.stringify({locale:'en',onboardingDone:true,checks:[]}));
  const root = join(temp,'project'); await mkdir(root);
  const quote = 'The API status must display Ready in the status component.';
  await writeFile(join(root, 'contract.md'), '# Integration contract\n' + quote);
  const definition = {name:'Status contract',requirement:quote,phases:[{name:'Read the status', actor:'visitor',route:'/',steps:[],observe:[{id:'mode',target:{label:'Mode'},read:'text'}],assert:[{name:'Status is Ready',left:'mode',op:'eq',right:{value:'Ready'}}]}]};
  const noAssertion = { ...definition, name:'Observation only', phases:definition.phases.map(p => ({...p,assert:[]})) };
  const unsupported = { ...definition, phases:definition.phases.map(p => ({...p,assert:p.assert.map(a => ({...a,right:{value:'Invented threshold'}}))})) };
  const inventedStep={...definition,phases:definition.phases.map(p=>({...p,assert:[],steps:[{action:'expectText',target:{label:'Mode'},text:'Ready tomorrow'}]}))};
  const sameReading={...definition,phases:definition.phases.map(p=>({...p,assert:p.assert.map(a=>({...a,right:{ref:a.left}}))}))};
  const actions: object[] = [noAssertion,unsupported,inventedStep,sameReading,definition].map(candidate => ({type:'prepare_journey',search:quote,definition:candidate}));
  actions.splice(2,0,{type:'read',path:'contract.md'});
  actions.push({type:'answer',text:'Prepared.'});
  const preview = createServer((req,res) => {
    if (req.url?.startsWith('/v1/')) { res.setHeader('content-type','application/json'); res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(actions.shift() ?? {type:'answer',text:'Done.'})}}]})); return; }
    if (req.url === '/missing') { res.writeHead(404); res.end('Missing'); return; }
    res.setHeader('content-type','text/html'); res.end('<!doctype html><html lang="en"><title>Fixture</title><main><h1>Service</h1><output aria-label="Mode">Waiting</output><button>Open</button></main></html>');
  });
  await new Promise<void>(done => preview.listen(0,'127.0.0.1',done));
  const address = preview.address(); if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
  const baseUrl = 'http://127.0.0.1:' + address.port;
  await writeAiSettings({mode:'api',connection:'direct',protocol:'openai',baseUrl:baseUrl+'/v1',model:'fixture',maxCalls:7,passes:1,verify:false,discover:false});
  const entry = await addProject(root,'Contract sample');
  await updateProject(entry.id,{pages:{baseUrl,routes:['/'],discover:false}});
  const roundId = newRoundId(), dir = shotsDir(entry.id,roundId); await mkdir(dir,{recursive:true});
  const browser = await chromium.launch(), server = await startConsole({port:0});
  try {
    const capture = await browser.newPage({viewport:{width:320,height:180}}); await capture.goto(baseUrl);
    const path = join(dir,'view-1111111111.png');
    const image = await capture.screenshot({path}); await writeFile(join(root,'design.png'),image);
    await capture.addStyleTag({content:'body {background:#444}'}); await capture.screenshot({path:join(root,'other.png')});
    await capture.setViewportSize({width:321,height:180}); await capture.screenshot({path:join(root,'larger.png')}); await capture.close();
    await saveRound(entry.id,await runCheck({source:root}),{roundId,capture:{baseUrl,viewport:'desktop',pages:[],captures:{},views:[{route:'/',width:320,image:path}],durationMs:0,cancelled:false}});
    const page = await browser.newPage({viewport:{width:1320,height:900}});
    const url = new URL(server.url); url.searchParams.set('project',entry.id); await page.goto(url.href);
    const category = page.getByLabel('Check category',{exact:true}); await category.selectOption('logic');
    await page.getByRole('button',{name:'Link a source clause'}).click();
    await page.getByLabel('Project file path or source title').fill('contract.md');
    await page.getByRole('button',{name:'Select a passage from project text'}).click();
    await page.getByRole('button',{name:'L2 · '+quote}).click();
    expect(await page.getByLabel('Component library mapping',{exact:true}).isChecked()).toBe(true);
    await page.getByRole('button',{name:'Save source'}).click();
    await page.locator('.assurance-panel summary').filter({hasText:'contract.md'}).click();
    await page.getByText('File verified · L2').waitFor();
    await page.getByRole('button',{name:'Plan a review for this run'}).click();
    await page.locator('.verification-task').first().waitFor(); expect(await page.locator('.verification-task').count()).toBe(3);
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Prepare scenario with selected model'}).click();
    await page.getByRole('button',{name:'Run test scenario'}).click();
    await page.getByText('Status contract · Failed',{exact:true}).waitFor();
    expect(await page.getByRole('button',{name:'Run test scenario'}).count()).toBe(1);
    await page.getByRole('tab',{name:'Check',exact:true}).click();
    await category.selectOption('fidelity');
    await page.getByRole('button',{name:'Compare design frame'}).click();
    await page.getByLabel('Frame revision or node').fill('Design R1 · Service');
    await page.getByLabel('I matched role', {exact:false}).check();
    const design = page.getByLabel('Design PNG in this project'), dialog = page.getByRole('dialog');
    for (const [file,status] of [['design.png','Matched within tolerance'],['other.png','Differences to review'],['larger.png','Dimensions differ']]) {
      await design.fill(file); await page.getByRole('button',{name:'Compare images'}).click(); await dialog.getByText(status,{exact:false}).waitFor();
      if (file === 'other.png') {
        await dialog.getByText('Compare design and observed view side by side',{exact:true}).click();
        await dialog.getByAltText('Design frame',{exact:true}).waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[role=dialog] .assurance-pair img')].filter(img => img.naturalWidth === 320).length === 2);
      }
    }
    await page.getByRole('button',{name:'Close',exact:true}).click();
    if (process.env.UXQA_GUIDANCE_EVIDENCE) {
      await mkdir(process.env.UXQA_GUIDANCE_EVIDENCE,{recursive:true});
      await page.screenshot({path:join(process.env.UXQA_GUIDANCE_EVIDENCE,'assurance-fidelity.png')});
    }
    await category.selectOption('accessibility');
    await page.getByRole('button',{name:'Run page sample'}).click();
    const firstSample=page.locator('.assurance-panel summary').filter({hasText:'Page sample · / ·'}).first();
    await firstSample.waitFor();
    expect(await firstSample.textContent()).toContain('Unverified');
    expect(await firstSample.evaluate(el=>el===document.activeElement)).toBe(true);
    await firstSample.click();
    await page.getByText(/Unverified · screen-reader/).waitFor();
    await page.getByLabel('Page route to sample').fill('/missing'); await page.getByRole('button',{name:'Run page sample'}).click();
    await page.locator('summary').filter({hasText:'Page sample · /missing'}).click();
    await page.getByText(/Blocked · reflow-320/).waitFor();
    await category.selectOption('usability');
    await page.getByRole('button',{name:'Record task observation'}).click();
    await page.getByLabel('Task tested').fill('Find the export');
    await page.getByLabel('Participant group and device conditions').fill('First-time desktop user');
    await page.getByLabel('Observed outcome').selectOption('assisted');
    await page.getByLabel('Observed difficulty').selectOption('discovery');
    await page.getByLabel('Observation or evidence location').fill('Participant requested help locating the export action.');
    await page.getByRole('button',{name:'Save observation record'}).click();
    await page.getByText('Independent completions: 0 / 1',{exact:true}).waitFor();
    await page.getByText(/Suggestion to test: Expose the action/).waitFor();
    await category.selectOption('performance');
    await page.getByRole('button',{name:'Run page sample'}).click();
    await page.locator('.assurance-panel summary').filter({hasText:'Page sample · / ·'}).first().click();
    expect(await page.locator('.assurance-panel pre').innerText()).toContain('"frameIntervals"');
    await writeFile(join(root,'contract.md'),'# Integration contract\nChanged requirement.');
    await page.reload(); await category.selectOption('logic');
    await page.locator('.assurance-panel summary').filter({hasText:'contract.md'}).click();
    await page.getByText(/File changed or unavailable/).waitFor();
    expect(await page.getByRole('button',{name:'Prepare scenario with selected model'}).isDisabled()).toBe(true);
  } finally {
    await browser.close(); await server.close(); await new Promise<void>(done => preview.close(() => done()));
    if (prior === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = prior;
    await rm(temp,{recursive:true,force:true});
  }
}, 100_000);
