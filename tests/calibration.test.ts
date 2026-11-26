import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { runCheck } from '../src/check/run.js';
import { writeAiSettings } from '../src/ai/model.js';
import { assuranceCatalog } from '../src/guidance/assurance.js';
import { addClause, addUsabilitySession } from '../src/ui/assurance.js';
import { calibrationMetrics, createReviewCase, reviewWorkspace, updateReviewCase } from '../src/ui/calibration.js';
import { addProject, saveRound } from '../src/ui/store.js';
import { startConsole } from '../src/ui/server.js';

async function environment(){
  const before=process.env.UXQA_HOME, dir=await mkdtemp(join(tmpdir(),'uxqa-calibration-'));
  const home=join(dir,'data'), root=join(dir,'source');await mkdir(home);await mkdir(root);process.env.UXQA_HOME=home;
  await writeFile(join(home,'access-settings.json'),JSON.stringify({locale:'en',onboardingDone:true,checks:[]}));
  await writeFile(join(root,'style.css'),'button {color:#222}');
  const entry=await addProject(root,'Acceptance sample'), result=await runCheck({source:root}), round=await saveRound(entry.id,result);
  return {entry,round,result,restore:async()=>{if(before===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=before;await rm(dir,{recursive:true,force:true});}};
}
const base={suite:'interaction',procedure:0,task:'Copy the report',scope:'First visit, desktop',source:'Approved task 4',
  expected:'Copy shows confirmation',observation:'A confirmation appeared',location:'Recorder 17',factIds:[],variant:'target',partition:'holdout'};
const first={reviewer:'A',grade:'pass',reason:'Confirmation visible'};

it('covers all eight suites and 24 procedures, fixes project assignment, isolates rounds and excludes retests',async()=>{
  const {entry,round,result,restore}=await environment();
  try{
    const saved=[];
    for(const suite of assuranceCatalog('en')){
      for(let i=0;i<suite.checks.length;i++){
        const c=await createReviewCase(entry,round,{...base,suite:suite.id,procedure:i},'en');
        await updateReviewCase(entry,c.id,'rate',first,'en');
        await updateReviewCase(entry,c.id,'rate',{...first,reviewer:'B'},'en');
        saved.push(c);
      }
    }
    const ws=await reviewWorkspace(entry,round,'fidelity','en');
    expect(ws.coverage).toHaveLength(8);expect(ws.coverage.every(s=>s.assessed===3)).toBe(true);
    await expect(createReviewCase(entry,round,{...base,partition:'development'},'en')).rejects.toThrow(/already fixed/);
    await expect(createReviewCase(entry,round,{...base,factIds:['foreign']},'en')).rejects.toThrow(/belong/);
    await expect(updateReviewCase(entry,saved[0].id,'model',{},'en')).rejects.toThrow(/before the first/);
    const observation=await addClause(entry,{source:'Code',locator:'L1',quote:'Current implementation',purpose:'observation',suites:['logic']});
    await expect(createReviewCase(entry,round,{...base,suite:'logic',clauseId:observation.id},'en')).rejects.toThrow(/requirement/);
    const next=await saveRound(entry.id,result), original=saved[0];
    const retry=await createReviewCase(entry,next,{...base,suite:original.suite,procedure:original.procedure,previous:original.id,factIds:[],observation:'',expected:'Changed'},'en');
    expect(retry.expected).toBe(original.expected);expect(retry.facts).toHaveLength(0);expect(retry.reviewCount).toBe(0);
    expect((await calibrationMetrics()).reduce((n,g)=>n+g.counts.cases,0)).toBe(24);
  }finally{await restore();}
});

it('withholds blind grades, gates missing or fabricated evidence, and computes agreement and escapes from independent labels',async()=>{
  const {entry,round,restore}=await environment();
  const prompts:string[]=[];
  const answer={grade:'pass',reason:'Confirmation shown',expectedQuote:'shows confirmation',citations:[{id:'recorded-observation',quote:'A confirmation appeared'}]};
  const replies:object[]=[answer,answer,{...answer,citations:[{id:'invented',quote:'A confirmation appeared'}]},answer,{...answer,grade:'friction'}];
  const model=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;prompts.push(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(replies.shift())}}]}));});
  await new Promise<void>(r=>model.listen(0,'127.0.0.1',r));
  try{
    const addr=model.address();if(!addr || typeof addr==='string')throw Error('Fixture address');
    await writeAiSettings({mode:'api',connection:'direct',protocol:'openai',model:'fixture',baseUrl:'http://127.0.0.1:'+addr.port+'/v1',passes:2,maxCalls:2,verify:false,discover:false});
    const action=(id:string,op:string,input:Record<string,unknown>={})=>updateReviewCase(entry,id,op,input,'en');
    const c=await createReviewCase(entry,round,base,'en');
    expect((await action(c.id,'model')).prediction).toBeUndefined();
    expect((await action(c.id,'rate',{...first,reviewer:' A ',grade:'blocker',reason:'private-blind-reason'})).ratings).toBeUndefined();
    expect((await calibrationMetrics())[0].counts.passed).toBe(0);
    await expect(action(c.id,'rate',{...first,reviewer:'a'})).rejects.toThrow(/different reviewer/);
    const conflict=await action(c.id,'rate',{...first,reviewer:'B',grade:'friction'});
    expect(conflict.needsDecision).toBe(true);expect(conflict.prediction).toBeUndefined();
    await expect(action(c.id,'resolve',first)).rejects.toThrow(/different reviewer/);
    const closed=await action(c.id,'resolve',{reviewer:'C',grade:'blocker',reason:'Attendees could not copy.',basis:'additional',location:'Session 23'});
    expect(closed.prediction?.grade).toBe('pass');expect(closed.prediction?.looks).toBe(2);
    expect((await calibrationMetrics())[0].counts).toMatchObject({escapedBlockers:1,reviewedPasses:1,extraEvidenceEscapes:1,humanAgree:0,doubleReviewed:1,missedIssues:1,humanIssues:1,matched:0});
    expect(prompts.join(' ')).not.toContain('private-blind-reason');
    for(const [suite,obs,reason] of [['interaction','A confirmation appeared','citation'],['interaction','A confirmation appeared','disagree'],['interaction','','usable observation'],['usability','Looks usable','task session']]){
      const sample=await createReviewCase(entry,round,{...base,suite,observation:obs,variant:'control'},'en');
      await action(sample.id,'model');
      await action(sample.id,'rate',{...first,grade:'unknown'});
      const result=await action(sample.id,'rate',{...first,reviewer:'B',grade:'unknown'});
      expect(result.prediction?.grade).toBe('unknown');expect(result.prediction?.reason).toContain(reason);
    }
    expect(prompts.length).toBe(5);
    const compare={...base,suite:'logic',procedure:1,task:'Change the window for A',scope:'A and B after publication',expected:'A changes from 24 to 48 after activation and B stays at 24',comparison:[
      {role:'baseline',text:'Window 24',location:'A before publication'},
      {role:'changed',text:'Window 48',location:'A after activation'},
      {role:'control',text:'Window 24',location:'B after activation'}]};
    const reveal=async(id:string)=>{
      await action(id,'model');await action(id,'rate',first);
      return (await action(id,'rate',{...first,reviewer:'B'})).prediction;
    };
    await expect(createReviewCase(entry,round,{...compare,comparison:[compare.comparison[0],compare.comparison[0]]},'en')).rejects.toThrow(/repeated/);
    const partial=await createReviewCase(entry,round,{...compare,comparison:compare.comparison.slice(0,2)},'en');
    expect((await reveal(partial.id))?.looks).toBe(0);
    const complete=await createReviewCase(entry,round,compare,'en');
    const propagationAnswer={...answer,reason:'A updated and B stayed at 24',expectedQuote:compare.expected};
    replies.push(propagationAnswer);expect((await reveal(complete.id))?.reason).toContain('all comparison roles');
    const cited={...propagationAnswer,citations:compare.comparison.map(r=>({id:'comparison-'+r.role,quote:r.text}))};
    replies.push(cited,cited);expect((await reveal((await createReviewCase(entry,round,compare,'en')).id))?.grade).toBe('pass');
    const userSession={task:base.task,cohort:'First-time user',evidence:'A confirmation appeared',outcome:'independent',friction:'none',reportedEase:2};
    await expect(addUsabilitySession(entry,round,{...userSession,reportedEase:8})).rejects.toThrow(/1–7/);
    const session=await addUsabilitySession(entry,round,userSession);
    const easeCase=await createReviewCase(entry,round,{...base,suite:'usability',factIds:[session.id]},'en');
    const usabilityResponse={...answer,citations:[{id:session.id,quote:'A confirmation appeared'}]};
    replies.push(usabilityResponse,usabilityResponse);expect((await reveal(easeCase.id))?.grade).toBe('pass');
    expect(prompts.join(' ')).not.toContain('reportedEase');
    expect((await calibrationMetrics()).find(r=>r.suite==='usability')?.counts).toMatchObject({passesWithEase:1,difficultPasses:1});
  }finally{await new Promise<void>(r=>model.close(()=>r()));await restore();}
});

it('completes blind review and opens its metrics through the desktop interface',async()=>{
  const {entry,restore}=await environment(),server=await startConsole({port:0}),browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1280,height:850}});
    const url=new URL(server.url);url.searchParams.set('project',entry.id);await page.goto(url.href);
    await page.getByLabel('Check category',{exact:true}).selectOption('interaction');
    await page.getByText('Review the three procedures',{exact:true}).click();
    await page.getByRole('button',{name:'Create case',exact:true}).first().click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Task goal').fill(base.task);await dialog.getByLabel('Role, page and conditions').fill(base.scope);
    await dialog.getByLabel('Observable acceptance criterion').fill(base.expected);await dialog.getByLabel('Criterion reference').fill(base.source);
    await dialog.getByLabel('Evaluation set for this project').selectOption('development');
    await dialog.getByLabel('Additional firsthand observation (optional)').fill(base.observation);
    await dialog.getByLabel('Observation location or record ID').fill(base.location);
    await dialog.getByRole('button',{name:'Save acceptance case'}).click();
    for(const alias of ['reader-A','reader-B']){
      await dialog.getByLabel('Reviewer alias').fill(alias);await dialog.getByLabel('Task outcome').selectOption('friction');
      await dialog.getByLabel('Observed behavior and evidence location').fill('Two attempts seen at Recorder 17');
      await dialog.getByRole('button',{name:'Submit blind rating'}).click();
      if(alias==='reader-A')await dialog.getByText('Independent review 2/2',{exact:true}).waitFor();
    }
    await dialog.getByText('Human result · Friction, task still achievable',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'View calibration metrics'}).click();
    await dialog.getByLabel('Project set').selectOption('development');await dialog.getByText(/Human agreement/).waitFor();
    expect(await dialog.innerText()).toContain('1/1 (100%)');
    const output=process.env.UXQA_CALIBRATION_EVIDENCE;
    if(output){await mkdir(output,{recursive:true});await page.screenshot({path:join(output,'calibration-desktop.png')});}
    await page.setViewportSize({width:390,height:844});
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    if(output)await page.screenshot({path:join(output,'calibration-narrow.png')});
    await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.reload();
    await page.getByLabel('Check category',{exact:true}).selectOption('interaction');
    await page.getByText(/Procedures with a definite human result 1\/3/).waitFor();
    await page.getByRole('button',{name:'Plan a review for this run'}).click();
    await dialog.locator('details.verification-task > summary').first().click();
    await dialog.getByRole('button',{name:'Create a blind review case for this procedure'}).first().click();
    await dialog.getByLabel('Observable acceptance criterion').waitFor();
  }finally{await browser.close();await server.close();await restore();}
},55_000);
