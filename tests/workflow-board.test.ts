import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { addProject, updateProject } from '../src/ui/store.js';
import { startConsole } from '../src/ui/server.js';
import { boardView } from '../src/ui/workflow-board.js';

async function environment(){
  const previous=process.env.UXQA_HOME,folder=await mkdtemp(join(tmpdir(),'uxqa-workflow-test-'));
  const home=join(folder,'home'),source=join(folder,'source');await mkdir(home);await mkdir(source);
  process.env.UXQA_HOME=home;
  await writeFile(join(home,'access-settings.json'),JSON.stringify({locale:'en',onboardingDone:true,checks:[]}));
  await writeFile(join(source,'main.tsx'),'export const Intro = () => <main>Welcome</main>;');
  const entry=await addProject(source,'Workflow sample'),server=await startConsole({port:0});
  const u=new URL(server.url),token=new URLSearchParams(u.hash.slice(1)).get('t')!;
  const base=u.origin+'/api/projects/'+entry.id;
  async function api(path:string,data?:Record<string,unknown>){
    const res=await fetch(base+path,{method:data?'POST':'GET',headers:{'x-uxqa-token':token,'content-type':'application/json'},body:data?JSON.stringify(data):undefined});
    return {status:res.status,data:await res.json()};
  }
  async function command(action:string,fields:Record<string,unknown>={}){
    const v=boardView(entry),r=v.runs.at(-1);
    return api('/workflow-board',{action,revision:v.revision,runId:r?.id,stepId:r?.steps[r.index]?.id,...fields});
  }
  return {entry,api,command,url:u,async close(){
    await server.close();if(previous===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=previous;
    await rm(folder,{recursive:true,force:true});
  }};
}

it('offers newly saved document tasks in an already open builder and gives an unbound step a recovery action',async()=>{
  const {url,api,entry,close}=await environment(),browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    url.searchParams.set('project',entry.id);url.searchParams.set('tab','board');await page.goto(url.href);
    await page.getByRole('button',{name:'Workflow builder',exact:true}).click();
    await page.getByRole('button',{name:'Add step',exact:true}).waitFor();
    const text='Saving a task makes it available in this project.';
    const source=await api('/assurance/import',{name:'Requirements.md',kind:'text',format:'md',revision:'a'.repeat(64),passages:[{locator:'L1',text}],gaps:[],suites:['logic']});
    expect(source.status).toBeLessThan(300);
    const saved=await api('/acceptance-tasks',{op:'create',source:source.data.id,index:0,quote:text,actor:'Reviewer',condition:'Builder open',action:'Select the saved task',expected:text});
    expect(saved.status).toBeLessThan(300);
    await page.getByRole('button',{name:'Add step',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Check or repair scope').selectOption({label:'Select the saved task'});
    await dialog.getByRole('button',{name:'Save step'}).click();
    await page.getByText('Select the saved task',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'Automatic',exact:true}).click();
    await page.getByRole('button',{name:'Start run',exact:true}).click();
    await page.getByRole('button',{name:'Open this acceptance task'}).click();
    await dialog.getByText(text,{exact:true}).first().waitFor();
  }finally{await browser.close();await close();}
},30000);

it('runs adjacent checks automatically, pauses for people and missing inputs, and preserves manual ordering and evidence',async()=>{
  const {entry,api,command,close}=await environment();
  const test=(id:string,scope='full')=>({id,kind:'test',name:id,scope});
  try{
    const repair={id:'R',kind:'repair',scope:'full',name:'B repair',from:'A'};
    await command('save',{steps:[repair,test('A')]});expect((await command('start')).status).toBe(400);
    const steps=[test('A'),test('B'),repair,test('C','usability'),test('D','accessibility')];
    await command('save',{steps});await command('mode',{mode:'auto'});
    expect((await command('start')).status).toBe(200);
    const read=()=>boardView(entry).runs.at(-1)!;
    await expect.poll(()=>read().index,{timeout:20000}).toBe(2);
    const [a,b]=read().steps;expect(a.result?.outcome).toBe('observed');expect(b.result?.ref).not.toBe(a.result?.ref);
    expect(read().steps[2].result).toBeUndefined();
    expect((await command('next')).status).toBe(409);
    expect((await command('adopt',{ref:'invented'})).status).toBe(409);
    expect((await command('record',{note:'Reviewed button',ref:'Page.tsx:1'})).data.runs.at(-1).steps[2].result.outcome).toBe('manual');
    await command('next');
    const session=await api('/assurance/session',{roundId:b.result?.roundId,task:'Find Intro',cohort:'First-time reader',outcome:'independent',friction:'none',evidence:'Found Welcome'});
    expect(session.status).toBeLessThan(300);
    expect((await api('/workflow-board/evidence')).data.items.map((i:{ref:string})=>i.ref)).toContain(session.data.id);
    await command('adopt',{ref:session.data.id});await command('next');
    await expect.poll(()=>read().steps[4].hold).toMatch(/preview URL/);
    expect(read().status).toBe('active');expect(read().steps[4].result).toBeUndefined();
    await command('stop');await command('mode',{mode:'manual'});await command('save',{steps:[test('Y'),test('X')]});
    await command('start');expect(read().steps[0].result).toBeUndefined();
    await command('execute');await expect.poll(()=>read().steps[0].result?.outcome).toBe('observed');
    expect(read().index).toBe(0);
    await command('next');expect(read().steps[1].result).toBeUndefined();
    await command('mode',{mode:'auto'});await expect.poll(()=>read().status).toBe('done');
    expect(boardView(entry).runs[0].status).toBe('stopped');
    expect((await command('save',{revision:0,steps:[]})).status).toBe(409);
  }finally{await close();}
},35000);

it('reports the mapping gap and finding directory for a source-only component step with a preview configured',async()=>{
  const {entry,command,api,close}=await environment();
  try{
    await mkdir(join(entry.root,'src/components/ui'),{recursive:true});
    const examples=join(entry.root,'examples/button');
    await mkdir(examples,{recursive:true});
    await writeFile(join(examples,'button.css'),'.demo { color: #336699; }');
    await updateProject(entry.id,{pages:{baseUrl:'http://127.0.0.1:1',routes:['/'],discover:false}});
    await command('save',{steps:[{id:'C',kind:'test',scope:'components',name:'Component mapping'}]});
    await command('mode',{mode:'auto'});
    expect((await command('start')).status).toBe(200);
    await expect.poll(()=>boardView(entry).runs.at(-1)?.steps[0].result?.outcome,{timeout:20000}).toBe('limited');
    const result=boardView(entry).runs.at(-1)!.steps[0].result!;
    expect(result.en).toContain('No mappable components identified');
    expect(result.en).toContain('examples/button (1)');
    const {round}=(await api('/rounds/'+result.roundId)).data;
    expect(round.partial).toBeUndefined();
    expect(round.capture).toBeUndefined();
  }finally{await close();}
},30000);

it('samples the configured route and stops an automatic sequence on incomplete browser evidence',async()=>{
  const {entry,command,close}=await environment(),visits:string[]=[];
  const fixture=createServer((req,res)=>{visits.push(req.url || '');res.writeHead(404,{'content-type':'text/html'});res.end('<title>Missing</title>');});
  try{
    await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r));
    const address=fixture.address();if(!address || typeof address==='string')throw new Error('Missing fixture port');
    await updateProject(entry.id,{pages:{baseUrl:'http://127.0.0.1:'+address.port,routes:['/default'],discover:false}});
    const steps=[{id:'a',kind:'test',scope:'interaction',route:'/target',name:'A'},{id:'b',kind:'test',scope:'full',name:'B'}];
    await command('save',{steps});await command('mode',{mode:'auto'});await command('start');
    await expect.poll(()=>boardView(entry).busy,{timeout:45000}).toBe(false);
    const run=boardView(entry).runs.at(-1)!;
    expect(run.index).toBe(0);expect(run.status).toBe('active');expect(run.steps[1].result).toBeUndefined();
    expect(['findings','limited']).toContain(run.steps[0].result?.outcome);
    expect(visits).toContain('/target');expect(visits).not.toContain('/default');
  }finally{await new Promise<void>(r=>fixture.close(()=>r()));await close();}
},55000);

it('builds and reorders columns in the desktop UI and carries the selected test into the project repair draft',async()=>{
  const {entry,url,close}=await environment(),browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1360,height:860}});
    url.searchParams.set('project',entry.id);url.searchParams.set('tab','board');await page.goto(url.href);
    await page.getByRole('tab',{name:'Workflow',exact:true}).click();
    await page.getByRole('button',{name:'Workflow builder',exact:true}).click();
    const dialog=page.getByRole('dialog');
    async function add(name:string,kind='test'){
      await page.getByRole('button',{name:'Add step',exact:true}).click();
      await dialog.getByLabel('Step type').selectOption(kind);
      await dialog.getByLabel('Step name (optional)').fill(name);
      if(kind==='repair')await dialog.getByLabel('Repair input').selectOption({label:'1 · A'});
      await dialog.getByRole('button',{name:'Save step'}).click();
      await page.locator('.flow-detail h3').filter({hasText:name}).waitFor();
    }
    await add('A');await add('C');await add('B repair','repair');
    await page.getByRole('button',{name:'Move earlier'}).click();
    await expect.poll(()=>page.locator('.flow-select strong').allTextContents()).toEqual(['A','B repair','C']);
    await page.locator('.flow-select').nth(2).dragTo(page.locator('.flow-select').first());
    await expect.poll(()=>page.locator('.flow-select strong').allTextContents()).toEqual(['C','A','B repair']);
    await page.getByRole('button',{name:'Automatic',exact:true}).click();
    await page.reload();await page.getByRole('button',{name:'Automatic',exact:true,pressed:true}).waitFor();
    await page.getByRole('button',{name:'Start run'}).click();await page.getByRole('button',{name:'Open project repair chat'}).waitFor({timeout:20000});
    await page.getByRole('button',{name:'Open project repair chat'}).click();
    expect(await page.locator('#agent-message').inputValue()).toContain('Source step · A');
    expect(await page.locator('#agent-message').inputValue()).toContain('Round 2');
    await page.getByRole('tab',{name:'Workflow',exact:true}).click();
    const out=process.env.UXQA_BOARD_SCREENS;
    if(out){await mkdir(out,{recursive:true});await page.getByRole('button',{name:'Open project repair chat'}).waitFor();await page.screenshot({path:join(out,'workflow-desktop.png')});}
    await page.setViewportSize({width:390,height:844});
    expect(await page.locator('.flow-track').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.locator('.flow-select').first().focus();
    await page.keyboard.press('Tab');await page.keyboard.press('Tab');
    expect(await page.locator('.flow-select').last().evaluate(el=>{
      const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return el===document.activeElement && el.contains(top);
    })).toBe(true);
    if(out)await page.screenshot({path:join(out,'workflow-narrow.png')});
    await page.getByRole('button',{name:'Record a human result'}).click();
    await dialog.getByLabel('Observed action and outcome').fill('Confirmed the target file');
    await dialog.getByLabel('Evidence location or record ID').fill('Intro.tsx:1');
    await dialog.getByRole('button',{name:'Save record'}).click();
    await page.getByRole('button',{name:'Finish run'}).click();
    await page.getByText('Last run completed').waitFor();
  }finally{await browser.close();await close();}
},60000);
