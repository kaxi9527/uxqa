import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runAudit } from '../src/runner.js';
import { runCheck } from '../src/check/run.js';
import { startConsole } from '../src/ui/server.js';
import { addProject, updateProject } from '../src/ui/store.js';
import { taskWorkspace } from '../src/ui/acceptance-tasks.js';

it('runs source rules on page code below an empty conventional library directory', async () => {
  const root = await mkdtemp(join(tmpdir(),'qa-empty-library-'));
  try {
    await mkdir(join(root,'src/ui/web'),{recursive:true});
    await writeFile(join(root,'package.json'),'{"name":"fixture"}');
    await writeFile(join(root,'src/ui/web/app.css'),'.widget{ color: #ba452f; }');
    const report = await runCheck({source:root});
    expect(report.library).toMatchObject({path:'src/ui',source:'convention',components:0});
    expect(report.violations.some(row=>row.rule==='basic/no-hardcoded-color')).toBe(true);
  } finally { await rm(root,{recursive:true,force:true}); }
});

it('waits for the real page and marks a missing readiness marker as blocked', async () => {
  const out = await mkdtemp(join(tmpdir(),'qa-readiness-'));
  const fixture = createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><html lang="en"><title>Readiness</title><main>Loading</main>'+
      (req.url==='/ready'?'<script>setTimeout(()=>document.querySelector("main").innerHTML="<h1 id=ready>Ready</h1>",750)</script>':'')+'</html>');
  });
  try {
    await new Promise<void>(resolve=>fixture.listen(0,'127.0.0.1',resolve));
    const baseUrl='http://127.0.0.1:'+(fixture.address() as {port:number}).port;
    const cfg=loadConfig({baseUrl,routes:['/ready','/missing'],readiness:{'/ready':{selector:'#ready'},'/missing':{selector:'#ready',timeoutMs:300}},
      viewports:[{name:'desktop',width:1000,height:700}],options:{axe:true,keyboard:false,reflow:false,reducedMotion:false,screenshots:false,trace:'off'}});
    const report=await runAudit(cfg,{outDir:out});
    expect(report.findings.some(row=>row.message.includes('level-one heading'))).toBe(false);
    expect(report.checks?.find(row=>row.route==='/ready'&&row.check==='axe')?.status).toBe('pass');
    expect(report.checks?.find(row=>row.route==='/missing'&&row.check==='page-load')).toMatchObject({status:'blocked',detail:expect.stringContaining('readiness timed out')});
  } finally {
    await new Promise<void>(resolve=>fixture.close(()=>resolve()));
    await rm(out,{recursive:true,force:true});
  }
},30000);

it('imports, binds and runs a basic requirement before the first inspection, and exposes navigation at 390px',async()=>{
  const root=await mkdtemp(join(tmpdir(),'qa-doc-flow-'));
  const previous=process.env.UXQA_HOME;
  process.env.UXQA_HOME=join(root,'data');
  const fixture=createServer((_,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><html lang=en><title>Fixture</title><main><h1>List</h1><button id="open">Open filter</button><p id="result" hidden>Filter open</p></main><script>document.querySelector("#open").onclick=()=>document.querySelector("#result").hidden=false</script></html>');
  });
  let server:Awaited<ReturnType<typeof startConsole>>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await new Promise<void>(resolve=>fixture.listen(0,'127.0.0.1',resolve));
    await mkdir(process.env.UXQA_HOME);
    await writeFile(join(process.env.UXQA_HOME,'access-settings.json'),JSON.stringify({locale:'en',onboardingDone:true,checks:[]}));
    const project=await addProject(root,'Fixture project');
    const entry=await updateProject(project.id,{pages:{baseUrl:'http://127.0.0.1:'+(fixture.address() as {port:number}).port,routes:['/'],discover:false}});
    server=await startConsole({port:0});
    browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const url=new URL(server.url);url.searchParams.set('project',project.id);await page.goto(url.href);
    await page.getByLabel('Check category').selectOption('logic');
    await page.locator('.evidence-panel input[type=file]').setInputFiles({name:'requirement.md',mimeType:'text/markdown',
      buffer:Buffer.from('Role: Visitor; Given: a list; When: Open filter; Then: Filter open')});
    await page.getByText('requirement.md',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'Check a requirement'}).click();
    await page.getByRole('button',{name:'Generate tasks from document'}).click();
    await page.getByRole('button',{name:'Save task',exact:true}).click();
    const saved=page.getByRole('status').filter({hasText:'Task saved to workflow'});
    await saved.waitFor();expect(await saved.evaluate(node=>document.activeElement===node)).toBe(true);
    await page.getByRole('button',{name:'Bind this task'}).click();
    await page.getByText('Create a check from this requirement',{exact:true}).click();
    await page.getByLabel('Verification type').selectOption('page-behavior');
    await page.getByLabel('Test route').fill('/');
    await page.getByLabel('Result CSS selector').fill('#result');
    await page.getByLabel('Page action',{exact:true}).selectOption('click');
    await page.getByLabel('Action CSS selector').fill('#open');
    await page.getByLabel('Expected result',{exact:true}).selectOption('text');
    await page.getByLabel('Expected visible text').fill('Filter open');
    await page.getByRole('button',{name:'Save and bind plan'}).click();
    await page.getByRole('button',{name:'Run task',exact:true}).click();
    await expect.poll(()=>taskWorkspace(entry).tasks[0]?.attempts.at(-1)?.status,{timeout:10000}).toBe('pass');
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    await page.getByLabel('Project page').selectOption('board');
    const stage=page.getByLabel('View stage');
    await stage.selectOption('done');
    expect(await page.locator('.kb-lane:visible').count()).toBe(1);
    expect(await page.locator('.kb-lane:visible').getAttribute('data-stage')).toBe('done');
  }finally{
    await browser?.close();await server?.close();
    await new Promise<void>(resolve=>fixture.close(()=>resolve()));
    if(previous===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=previous;
    await rm(root,{recursive:true,force:true});
  }
},40000);
