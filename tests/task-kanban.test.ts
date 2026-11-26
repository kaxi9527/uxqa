import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {it,expect} from 'vitest';
import {addProject,dataDir,saveRound} from '../src/ui/store.js';
import {taskAction,taskBoard} from '../src/ui/acceptance-tasks.js';
import {startConsole} from '../src/ui/server.js';
import {runCheck} from '../src/check/run.js';
import {loadConfig} from '../src/config.js';
import {runAudit} from '../src/runner.js';

async function fixture(){
  const tmp=await mkdtemp(join(tmpdir(),'uxqa-kanban-')),previous=process.env.UXQA_HOME;
  process.env.UXQA_HOME=join(tmp,'data');
  const src=join(tmp,'studio');await mkdir(src);await mkdir(dataDir());
  await writeFile(join(dataDir(),'access-settings.json'),JSON.stringify({locale:'en',onboardingDone:true,checks:[]}));
  const project=await addProject(src,'Studio');
  const board=()=>taskBoard(project);
  const row=(title:string)=>board().tasks.find(t=>t.title===title)!;
  const create=(title:string,priority?:string)=>taskAction(project,{op:'board-create',title,priority,expected:'The intended task is achievable',locator:'Product specification §2'});
  const move=(title:string,to:string,fields:Record<string,unknown>={})=>{
    const t=row(title);return taskAction(project,{op:'move',id:t.id,stamp:t.stamp,to,...fields});
  };
  return {project,src,board,row,create,move,async close(){if(previous===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=previous;await rm(tmp,{recursive:true,force:true});}};
}

it('passes the built-in interaction scenarios against UXQA itself',async()=>{
  const f=await fixture();
  let server:Awaited<ReturnType<typeof startConsole>>|undefined;
  try {
    await f.create('Keyboard task','P1');
    server=await startConsole({port:0});
    const url=new URL(server.url);
    const route=(query:string)=>'/?project='+f.project.id+'&'+query+url.hash;
    const board=route('tab=board'), settings=route('settings=1');
    const css=(value:string)=>({css:value}),exact=(value:string)=>({text:value,exact:true});
    const scenarios=[
      {type:'failure-recovery',route:board,request:'**/api/projects/*/acceptance-tasks/board',error:exact('Temporarily unavailable'),ready:{role:'button',name:'New task'}},
      {type:'save-focus',route:board,setup:[{action:'click',target:exact('Keyboard task')},
        {action:'click',target:css('[data-priority-summary]')},{action:'selectOption',target:{label:'Change priority'},value:'P2'}],
        save:{role:'button',name:'Apply priority'},saved:exact('Priority · P2 · Manual'),continuation:css('[data-priority-summary]')},
      {type:'language-entry',route:settings,setup:[{action:'selectOption',target:css('.access-panel select'),value:'zh'},
        {action:'waitFor',target:css('html:lang(zh) .access-panel select')}],switcher:css('.access-panel select'),option:'en',lang:'en',entry:{role:'link',name:'Skip to main content'}},
    ];
    const readiness=Object.fromEntries([board,settings].map(route=>[route,{selector:'html[data-qa-ready="true"] #workspace h1'}]));
    const result=await runAudit(loadConfig({baseUrl:url.origin,routes:[board,settings],readiness,scenarios,viewports:[{name:'desktop',width:1280,height:800}],
      options:{axe:false,keyboard:false,reflow:false,reducedMotion:false,trace:'off',screenshots:false}}),{outDir:join(dataDir(),'self-check')});
    const observed=result.checks.filter(c=>scenarios.some(s=>s.type===c.check));
    expect(observed.map(c=>[c.check,c.status]),observed.filter(c=>c.status!=='pass').map(c=>c.detail.replace(/#t=[^\s]+/g,'[session]')).join('\n')).toEqual(
      scenarios.map(s=>[s.type,'pass']));
  } finally {await server?.close();await f.close();}
},60000);
const evidence={note:'Observed the behavior in the original test conditions',ref:'Run 17, step 2'};

it('enforces six stages, returns failed retests to repair and preserves a manual priority across the complete repair loop',async()=>{
  const f=await fixture();
  try{
    await f.create('Checkout');expect(f.row('Checkout')).toMatchObject({stage:'untested',priority:'P2',mode:'auto'});
    await expect(f.move('Checkout','done',evidence)).rejects.toThrow(/unavailable/);
    await f.move('Checkout','testing');
    await expect(f.move('Checkout','unfixed')).rejects.toThrow(/evidence/);
    await f.move('Checkout','unfixed',{...evidence,impact:'major'});expect(f.row('Checkout').priority).toBe('P1');
    expect(f.row('Checkout').priorityChanges.at(-1)).toMatchObject({from:'P2',to:'P1',mode:'auto',reason:'major'});
    const change=async(mode:string,priority?:string)=>{const t=f.row('Checkout');await taskAction(f.project,{op:'priority',id:t.id,stamp:t.stamp,mode,priority});};
    await change('manual','P0');
    await f.move('Checkout','repairing');
    await expect(f.move('Checkout','done',evidence)).rejects.toThrow(/unavailable/);
    await f.move('Checkout','unreviewed',{note:'Changed submission handling',ref:'Form.tsx:5'});
    await f.move('Checkout','unfixed',{note:'Failed again after retry',ref:'Run 18',impact:'friction'});
    const after=f.row('Checkout');expect(after).toMatchObject({stage:'unfixed',priority:'P0',mode:'manual',suggested:{level:'P2'}});
    expect(after.events.at(-1)?.ref).toBe('Run 18');
    await change('auto');expect(f.row('Checkout').priority).toBe('P2');
    await f.move('Checkout','repairing');await f.move('Checkout','unreviewed',evidence);await f.move('Checkout','done',evidence);
    expect(f.board().next).toBeUndefined();expect(f.board().tasks).toHaveLength(1);
    await f.move('Checkout','unfixed',{...evidence,impact:'critical'});expect(f.row('Checkout').priority).toBe('P0');
    await f.create('Initial test');await f.move('Initial test','testing');await f.move('Initial test','done',evidence);
    expect(f.row('Initial test').events.at(-1)?.from).toBe('testing');
  }finally{await f.close();}
});

it('honors project defaults, skips blocked work, chooses retests first within a priority and restores legacy evidence',async()=>{
  const f=await fixture();
  try{
    await f.create('Review','P1');await f.move('Review','testing');await f.move('Review','unfixed',evidence);
    await f.move('Review','repairing');await f.move('Review','unreviewed',evidence);
    await f.create('Unstarted','P1');expect(f.board().next).toBe(f.row('Review').id);
    await f.create('Critical','P0');await f.move('Critical','untested',{note:'Missing role fixture',ref:'QA environment'});
    expect(f.row('Critical').gap).toBe(true);expect(f.board().next).toBe(f.row('Review').id);
    await expect(f.move('Critical','testing')).rejects.toThrow(/blocker/);
    expect(f.row('Critical').gap).toBe(true);
    await f.move('Critical','untested',{...evidence,resume:true});expect(f.board().next).toBe(f.row('Critical').id);
    await taskAction(f.project,{op:'priority-default',mode:'manual'});await f.create('Triage');
    expect(f.row('Triage').priority).toBeUndefined();expect(f.row('Triage').mode).toBe('manual');
    const stale=f.row('Critical');await f.move('Critical','testing');
    await expect(taskAction(f.project,{op:'priority',id:stale.id,stamp:stale.stamp,mode:'manual',priority:'P3'})).rejects.toThrow(/Refresh/);
    const path=join(dataDir(),'projects',f.project.id,'acceptance-tasks.json');
    const old=JSON.parse(await readFile(path,'utf8'));
    old.tasks.push({id:'legacy',action:'Legacy passed task',imported:new Date().toISOString(),attempts:[{id:'first',status:'pass',at:new Date().toISOString()}]});
    await writeFile(path,JSON.stringify(old));expect(f.row('Legacy passed task').stage).toBe('done');
  }finally{await f.close();}
});

it('links a repeated finding to the same card and preserves both rounds',async()=>{
  const f=await fixture();
  try{
    await writeFile(join(f.src,'site.css'),'button{color:#123456;background:#fff}');
    const r=await runCheck({source:f.src}),a=await saveRound(f.project.id,r,{roundId:'first-round'}),b=await saveRound(f.project.id,r,{roundId:'second-round'});
    expect(r.violations.length).toBeGreaterThan(0);const fingerprint=r.violations[0].fingerprint;
    for(const round of [a,b,b])await taskAction(f.project,{op:'board-create',roundId:round.id,fingerprint,title:'Colors',locator:'site.css:1',expected:'Follow approved colors'});
    expect(f.board().tasks).toHaveLength(1);expect(f.row('Colors').findingRounds).toEqual([a.id,b.id]);
  }finally{await f.close();}
});

it('uses the default project board to create, prioritize, drag, record evidence, and restore progress',async()=>{
  const f=await fixture(),server=await startConsole({port:0}),browser=await chromium.launch();
  try{
    const p=await browser.newPage({viewport:{width:1440,height:900}}),u=new URL(server.url);u.searchParams.set('tab','board');u.searchParams.set('project',f.project.id);await p.goto(u.href);
    const dialog=p.getByRole('dialog'),card=()=>p.getByRole('button',{name:/QA-.*Keyboard checkout/i});
    await p.getByRole('button',{name:'Status board',exact:true,pressed:true}).waitFor();
    await p.locator('.kb-lane h3').first().waitFor();
    expect(await p.locator('.kb-lane h3').allTextContents()).toEqual(['Untested','Testing','Needs repair','Repairing','Awaiting retest','Completed']);
    await p.getByRole('button',{name:'New task',exact:true}).click();
    await dialog.getByLabel('Task name').fill('Keyboard checkout');await dialog.getByLabel('Expected outcome').fill('Submit with Enter');
    await dialog.getByLabel('Page or source location').fill('/checkout');await dialog.getByRole('button',{name:'Create task'}).click();
    await card().dragTo(p.locator('.kb-testing .kb-empty'));await p.locator('.kb-testing .kb-card').waitFor();
    await card().click();await dialog.getByRole('button',{name:'Fail initial test',exact:true}).click();await dialog.getByLabel('Outcome or reason').fill('Enter does not submit');
    await dialog.getByLabel('Evidence location or record ID').fill('Capture 1');await dialog.getByLabel('Verified impact').selectOption('major');await dialog.getByRole('button',{name:'Fail initial test'}).click();
    await p.locator('.kb-unfixed .P1').waitFor();
    await p.getByRole('button',{name:'Next task'}).click();
    await dialog.getByText(/^Priority · /).click();await dialog.getByLabel('Change priority').selectOption('P0');await dialog.getByRole('button',{name:'Apply priority'}).click();
    await dialog.getByText('Priority · P0 · Manual').waitFor();await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await p.reload();await p.locator('.kb-unfixed .P0').waitFor();
    await p.getByRole('button',{name:'Workflow builder',exact:true}).click();await p.getByRole('button',{name:'Step by step',exact:true}).waitFor();
    await p.getByRole('button',{name:'Status board',exact:true}).click();await p.setViewportSize({width:390,height:844});
    const stage=p.getByLabel('View stage');
    await stage.selectOption('unfixed');
    expect(await p.locator('.kb-lane:visible').getAttribute('data-stage')).toBe('unfixed');
    expect(await p.locator('.kb-lanes').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }finally{await browser.close();await server.close();await f.close();}
},50000);
