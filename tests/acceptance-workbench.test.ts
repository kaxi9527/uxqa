import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {it,expect} from 'vitest';
import {runCheck} from '../src/check/run.js';
import {writeAiSettings} from '../src/ai/model.js';
import {addProject,updateProject,saveRound,dataDir,shotsDir,newRoundId} from '../src/ui/store.js';
import {importEvidence,storeFrame} from '../src/ui/evidence.js';
import {taskDrafts,taskAction,taskWorkspace,taskBoard} from '../src/ui/acceptance-tasks.js';
import {getProjectAgent} from '../src/ui/project-agent.js';
import {projectStorage} from '../src/ui/project-storage.js';
import {compareDesign} from '../src/ui/assurance.js';
import {startConsole} from '../src/ui/server.js';
import {boardCommand,boardEvidence,boardView} from '../src/ui/workflow-board.js';

it('binds a quoted requirement without a model and verifies a repair on the identical plan',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-master-requirement-')),prior=process.env.UXQA_HOME;
  process.env.UXQA_HOME=join(dir,'state');let fixed=false;
  const preview=createServer((req,res)=>{
    res.setHeader('content-type','text/html');
    res.end(req.url==='/away'?'<main id="away">Other page</main>':'<main><p id="id">item-7</p><input id="draft" value="initial"></main><script>draft.oninput=()=>sessionStorage.edit=draft.value;'+(fixed?'if(sessionStorage.edit)draft.value=sessionStorage.edit;':'')+'</script>');
  });
  let server:Awaited<ReturnType<typeof startConsole>>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await mkdir(dataDir());await writeFile(join(dataDir(),'access-settings.json'),JSON.stringify({locale:'en',onboardingDone:true,checks:[]}));
    const root=join(dir,'site');await mkdir(root);await writeFile(join(root,'package.json'),'{"name":"draft"}');
    const p=await addProject(root,'Draft review');await saveRound(p.id,await runCheck({source:root}));
    await new Promise<void>(resolve=>preview.listen(0,'127.0.0.1',resolve));
    const entry=await updateProject(p.id,{pages:{baseUrl:'http://127.0.0.1:'+(preview.address() as {port:number}).port,routes:['/','/away'],discover:false}});
    const quote='Role: Reader; Given: an open draft; When: leaving and returning; Then: retain my edit';
    const source=await importEvidence(p,{kind:'text',name:'Draft requirements',format:'md',revision:createHash('sha256').update(quote).digest('hex'),passages:[{locator:'§3',text:quote}],gaps:[],suites:['logic']});
    const [draft]=(await taskDrafts(p,{source:source.id})).drafts;
    const task=(await taskAction(p,{op:'create',...draft})).tasks[0];
    server=await startConsole({port:0});browser=await chromium.launch();const page=await browser.newPage();
    const url=new URL(server.url);url.searchParams.set('project',p.id);url.searchParams.set('tab','board');await page.goto(url.href);
    await page.getByRole('button',{name:'Acceptance tasks',exact:true}).click();
    await page.getByText('Create a check from this requirement',{exact:true}).click();await page.getByLabel('Verification type').selectOption('return-state');
    for(const [label,value] of Object.entries({'Edit route':'/','Object identity control':'#id','Editable input':'#draft','Test edit':'edited','Away route':'/away','Away page ready indicator':'#away'}))await page.getByLabel(label,{exact:true}).fill(value);
    await page.getByLabel('Expected on return').selectOption('retain');
    await page.getByRole('button',{name:'Save and bind plan'}).click();
    await page.getByText(/Bound scenario ·/).waitFor();
    expect(await page.title()).toBe('QA Master');
    const run=await taskAction(entry,{op:'run',id:task.id}),first=run.tasks[0].attempts.at(-1)!;
    expect(first.status).toBe('fail');
    for(const to of ['repairing','unreviewed'])await taskAction(entry,{op:'move',id:task.id,stamp:taskBoard(entry).tasks[0].stamp,to,note:'Draft persistence corrected',ref:'sample revision two'});
    fixed=true;
    const reviewed=(await taskAction(entry,{op:'verify',id:task.id})).tasks[0].attempts.at(-1)!;
    expect(reviewed).toMatchObject({planId:first.planId,repairOf:first.id,status:'pass'});
  }finally{await browser?.close();await server?.close();await new Promise<void>(done=>preview.close(()=>done()));
    if(prior===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=prior;await rm(dir,{recursive:true,force:true});}
},50000);

it('runs a sourced task, fixes the observed defect and replays all three bound phases',async()=>{
  const prior=process.env.UXQA_HOME,dir=await mkdtemp(join(tmpdir(),'uxqa-task-run-'));
  const home=join(dir,'home'),root=join(dir,'project');await mkdir(home);await mkdir(root);process.env.UXQA_HOME=home;
  const quote='Role: Visitor; Given: Published; When: Read status; Then: Ready for the changed object and Old for the baseline and control.';
  const definition={name:'Propagate one change',requirement:quote,phases:['baseline','changed','control'].map((name,i)=>({name,actor:'viewer',route:'/'+name,steps:[],
    observe:[{id:'status'+i,target:{label:'Mode'},read:'text'}],assert:[{name:'Read '+name,left:'status'+i,op:'eq',right:{value:i===1?'Ready':'Old'}}]}))};
  const actions:unknown[]=[{type:'prepare_journey',search:quote,definition},{type:'answer',text:'Plan ready.'}];
  const site=createServer(async(req,res)=>{
    if(req.url==='/v1/chat/completions'){res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(actions.shift()??{type:'answer',text:'Complete'})}}]}));return;}
    const value=req.url==='/changed'?(await readFile(join(root,'status.txt'),'utf8')).trim():'Old';
    res.setHeader('content-type','text/html');res.end('<html><body><output aria-label="Mode">'+value+'</output></body></html>');
  });
  await new Promise<void>(r=>site.listen(0,'127.0.0.1',r));
  try{
    const addr=site.address();if(!addr||typeof addr==='string')throw Error('Missing local fixture');
    const url='http://127.0.0.1:'+addr.port;
    await writeFile(join(root,'status.txt'),'Wrong');await writeFile(join(root,'main.js'),'export const ok=true;');
    const p=await addProject(root);await updateProject(p.id,{pages:{baseUrl:url,routes:['/'],discover:false}});const entry={...p,pages:{baseUrl:url,routes:['/'],discover:false}};
    const round=await saveRound(p.id,await runCheck({source:root}));
    await writeAiSettings({mode:'api',connection:'direct',protocol:'openai',model:'fixture',baseUrl:url+'/v1',passes:1,maxCalls:8,verify:false,discover:false});
    const source=await importEvidence(p,{kind:'text',name:'Contract',format:'md',revision:createHash('sha256').update(quote).digest('hex'),passages:[{locator:'§1',text:quote}],gaps:[],suites:['logic']});
    const d=(await taskDrafts(p,{source:source.id})).drafts[0];expect(d.actor).toBe('Visitor');expect(d.condition).toBe('Published');
    await expect(taskAction(p,{op:'create',...d,quote:'Imaginary'})).rejects.toThrow(/excerpt/);
    const task=(await taskAction(p,{op:'create',...d})).tasks[0];
    await taskAction(entry,{op:'prepare',id:task.id});
    const plan=(await getProjectAgent(p.id)).messages.find(m=>m.kind==='journey-plan');expect(plan).toBeDefined();
    await expect(taskAction(entry,{op:'bind',id:task.id,planId:plan!.id,controls:['changed','changed','changed']})).rejects.toThrow(/distinct/);
    await taskAction(entry,{op:'bind',id:task.id,planId:plan!.id,controls:['baseline','changed','control']});
    const scope='task-'+task.id;
    const command=(action:string,fields:Record<string,unknown>={})=>{
      const view=boardView(entry),r=view.runs.at(-1);
      return boardCommand(entry,{action,revision:view.revision,runId:r?.id,stepId:r?.steps[r.index]?.id,...fields},async()=>round);
    };
    command('save',{steps:[{id:'A',kind:'test',scope,name:'A'},{id:'B',kind:'repair',scope,name:'B',from:'A'}]});command('mode',{mode:'auto'});command('start');
    await expect.poll(()=>boardView(entry).runs[0].steps[0].result?.outcome).toBe('findings');
    expect(taskWorkspace(p).tasks[0].attempts[0].status).toBe('fail');command('next');
    actions.push({type:'read',path:'status.txt'},{type:'replace',path:'status.txt',search:'Wrong',replace:'Ready',reason:'Correct the failing changed object status shown in the tested page.'},{type:'answer',text:'Changed the fixture.'});
    try{await taskAction(entry,{op:'repair',id:task.id});}
    catch(e){throw new Error(String(e)+' · '+(await getProjectAgent(p.id)).messages.slice(-5).map(m=>m.text.slice(0,180)).join(' / '));}
    const after=taskWorkspace(p);expect(after.tasks[0].attempts.map(a=>a.status)).toEqual(['fail','pass']);
    expect((await boardEvidence(entry)).map(e=>e.ref)).toContain(after.tasks[0].attempts[1].id);
    expect(after.tasks[0].attempts[1].edited).toContain('status.txt');expect(after.metrics).toMatchObject({timed:1,repairs:1,verified:1});
    await taskAction(entry,{op:'verify',id:task.id});expect(taskWorkspace(p).metrics.repairs).toBe(1);
    const closed=taskBoard(p).tasks[0];expect(closed.stage).toBe('done');
    expect(closed.events.map(e=>e.to)).toContain('repairing');
    await writeFile(join(root,'status.txt'),'Wrong');
    const replay=taskAction(entry,{op:'verify',id:task.id});
    expect(taskBoard(p).busy).toBe(true);
    try{
      await taskAction(entry,{op:'priority',id:task.id,stamp:taskBoard(p).tasks[0].stamp,mode:'manual',priority:'P0'});
      await taskAction(entry,{op:'priority-default',mode:'manual'});
    }finally{await replay;}
    expect(taskBoard(p).defaultPriority).toBe('manual');
    const reopened=taskBoard(p).tasks[0];expect(reopened).toMatchObject({id:closed.id,stage:'unfixed',priority:'P0',mode:'manual'});
    expect(reopened.events.at(-1)).toMatchObject({from:'unreviewed',to:'unfixed',by:'system'});
  }finally{await new Promise<void>(r=>site.close(()=>r()));if(prior===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=prior;await rm(dir,{recursive:true,force:true});}
},65000);

it('maps a frame region, keeps human review and history when cleaning only managed media, and opens the desk in the browser',async()=>{
  const prior=process.env.UXQA_HOME,dir=await mkdtemp(join(tmpdir(),'uxqa-task-media-'));
  process.env.UXQA_HOME=join(dir,'home');const root=join(dir,'project');await mkdir(dataDir());await mkdir(root);
  await writeFile(join(dataDir(),'access-settings.json'),JSON.stringify({locale:'en',onboardingDone:true,checks:[]}));
  const browser=await chromium.launch(),server=await startConsole({port:0});
  try{
    const p=await addProject(root),roundId=newRoundId(),media=shotsDir(p.id,roundId);
    await mkdir(media,{recursive:true});await writeFile(join(root,'page.js'),'export const page = true;');
    const page=await browser.newPage({viewport:{width:200,height:100}});
    await page.setContent('<body style="margin:0"><div style="background:black;width:40px;height:40px"></div></body>');
    const design=await page.screenshot(),frame=await storeFrame(p,design,'Ready',['fidelity']);
    await page.addStyleTag({content:'body{background:red}'});const image=join(media,'view-abcdef1234.png');await page.screenshot({path:image});
    const region={x:0,y:0,width:40,height:40},view={route:'/',width:200,image,state:'default',regions:[{name:'Badge',...region}]};
    const round=await saveRound(p.id,await runCheck({source:root}),{roundId,capture:{baseUrl:'http://localhost',pages:[],captures:{},views:[view,{...view,route:'/items'}],viewport:'desktop',durationMs:0,cancelled:false}});
    const compared=await compareDesign(p,round,{view:'view-abcdef1234.png',evidenceId:frame.id,locator:'Badge v1',aligned:true,region});
    expect(compared).toMatchObject({status:'matched',component:'Badge',totalPixels:1600,changedPixels:0,impacted:['/','/items']});
    await page.setViewportSize({width:1280,height:850});
    const checkUrl=new URL(server.url);checkUrl.searchParams.set('project',p.id);checkUrl.searchParams.set('tab','checks');await page.goto(checkUrl.href);
    await page.getByText(/Sources for this check/).click();
    await page.getByRole('button',{name:'Compare with round capture'}).click();
    const compareDialog=page.getByRole('dialog');
    await compareDialog.getByText('Select component region',{exact:true}).click();
    const designFrame=compareDialog.locator('.design-region-image img');await designFrame.waitFor();
    await expect.poll(()=>designFrame.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBe(200);
    await designFrame.click({position:{x:15,y:15}});
    expect(await compareDialog.getByLabel('Component name (manual fallback)').inputValue()).toBe('Badge');
    await compareDialog.getByLabel(/I matched role/).check();
    await compareDialog.getByRole('button',{name:'Compare images'}).click();
    await compareDialog.getByText(/0 \/ 1600 pixels/).waitFor();
    await compareDialog.getByRole('button',{name:'Close',exact:true}).click();
    const feedback={op:'feedback',target:'round',roundId:round.id,observer:'A',choice:'missed',note:'Could not find the action',impact:true,suite:'accessibility',assistive:'VoiceOver test'};
    await taskAction(p,feedback);const record=taskWorkspace(p).feedback[0];
    await taskAction(p,{op:'escalate',roundId,target:record.target,procedure:1,partition:'development',goal:'Find the action',scope:'Keyboard',expected:'Action reachable',source:'Design brief',observation:'Focus returned to the title',location:'Field session 2'});
    const sample=join(dataDir(),'projects',p.id,'assurance','sample-evidence',randomUUID());await mkdir(sample,{recursive:true});
    await writeFile(join(sample,'page.trace.zip'),'trace');await writeFile(join(sample,'keep.json'),'{}');
    expect((await projectStorage(p,'traces')).removed).toBe(1);await access(join(sample,'keep.json'));await access(image);
    expect((await projectStorage(p,'screenshots')).removed).toBe(1);expect(taskWorkspace(p).feedback[0].caseId).toBeTruthy();
    await access(join(dataDir(),'rounds',p.id,round.id+'.json'));
    await page.setViewportSize({width:1280,height:850});const url=new URL(server.url);url.searchParams.set('project',p.id);url.searchParams.set('tab','board');await page.goto(url.href);
    await page.getByRole('button',{name:'Acceptance tasks',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByText('Project measures',{exact:true}).waitFor();await dialog.getByText(/Needs blind review/).click();
    await dialog.getByRole('button',{name:/Open blind review/}).click();await page.getByLabel('Reviewer alias').waitFor();
  }finally{await browser.close();await server.close();if(prior===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=prior;await rm(dir,{recursive:true,force:true});}
},55000);
