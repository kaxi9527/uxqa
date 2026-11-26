import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {it,expect} from 'vitest';
import {draftPassage,inspectRequirements} from '../src/requirement-drafts.js';
import {loadConfig} from '../src/config.js';
import {runCheck} from '../src/check/run.js';
import {executeStep} from '../src/steps.js';
import {checkPageAccess} from '../src/page-access.js';
import {runAudit} from '../src/runner.js';
import {writeReports} from '../src/report-writer.js';

it('preserves document evidence and exposes unbound prose without inventing a condition or an action',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-clauses-'));
  try{
    const row='| 类型 | 展示分「公开」和「归档」，归档类没有编辑和删除。 |';
    const requirement='- **创建记录**：输入名称。操作：预览、保存。';
    const note='- 奖励：条件、金额、说明。';
    const file=join(dir,'requirements.md');
    await writeFile(file,[row,'',requirement,note].join('\n'));
    const result=await inspectRequirements(file);
    expect(result.executed).toBe(false);
    expect(result.drafts[0]).toMatchObject({locator:'L1',quote:row,expected:row,bindingStatus:'needs-binding'});
    expect(result.drafts[1]).toMatchObject({locator:'L3',action:'',expected:requirement});
    expect(draftPassage(note)).toMatchObject({condition:'',bindingStatus:'needs-binding'});
    expect(()=>loadConfig({baseUrl:'http://localhost',requirementChecks:[{kind:'setting-propagation'}]})).toThrow(/requirementChecks\[0\].*route.*field.*readers.*Allowed/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

it('checks actual widths in TSX and Vue while ignoring breakpoint syntax and effective width caps',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-widths-'));
  try{
    const elements=['@min-[881px]:w-[740px]','max-[1080px]:grid-cols-6','@max-[561px]/panel:grid-cols-2','w-[632px] max-w-full','w-[690px] max-w-none','w-[710px] md:max-w-full'];
    const nodes=elements.map(value=>'<div class="'+value+'"></div>').join('\n');
    await writeFile(join(dir,'package.json'),'{"name":"sample"}');
    await writeFile(join(dir,'Page.tsx'),'export const Page=()=> <>'+nodes.replaceAll('class=','className=')+'</>');
    await writeFile(join(dir,'Page.vue'),'<template>'+nodes+'</template>');
    const {violations}=await runCheck({source:dir});
    for(const file of ['Page.tsx','Page.vue']){
      const widths=violations.filter(v=>v.file===file && v.rule==='basic/no-wide-fixed-width');
      for(const value of ['740px','690px','710px'])expect(widths.some(v=>v.name.includes(value)),file+' '+value).toBe(true);
      expect(widths.some(v=>v.name.includes('632px'))).toBe(false);
      expect(violations.some(v=>v.file===file && v.rule==='basic/no-arbitrary-size' && /881px|1080px|561px/.test(v.name))).toBe(false);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

it('offers a one-second binding hint without accepting another role or rejecting a late correct role',async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    await page.setContent('<a href="#">Open item</a>');
    const step={action:'expectVisible',target:{role:'button',name:'Open item',exact:true}} as const;
    const started=Date.now(),hints:{text:string;ms:number}[]=[];
    const context={requests:[],timeoutMs:1700,onDiagnostic:(text:string)=>hints.push({text,ms:Date.now()-started})};
    await expect(executeStep(page,step,context)).rejects.toThrow(/1 link/);
    expect(hints[0].text).toContain('0 visible matches');expect(hints[0].ms).toBeLessThan(1500);
    await page.evaluate(()=>setTimeout(()=>{const b=document.createElement('button');b.textContent='Open item';document.body.append(b);},950));
    await executeStep(page,step,context);
    await page.setContent('<button role="switch" aria-label="Open item" aria-checked="false">◉</button>');
    await expect(executeStep(page,step,{requests:[],timeoutMs:900})).rejects.toThrow(/1 switch/);
    const form='<form><input type=password><button>Sign in</button></form>';
    await page.setContent('<main><h1>Catalog</h1><button>View orders</button></main><aside>'+form+'</aside>');
    await checkPageAccess(page,'https://example.test/catalog',null);
    await page.setContent('<main><h1>Sign in to continue</h1>'+form+'</main>');
    await expect(checkPageAccess(page,'https://example.test/catalog',null)).rejects.toThrow(/Login required/);
  }finally{await browser.close();}
});

it('aggregates a failing accessibility check and blocks a protected route while reporting simple mock flows accurately',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-coverage-'));
  const server=createServer((req,res)=>{
    if(req.url==='/private'){res.writeHead(302,{location:'/login'});res.end();return;}
    res.setHeader('content-type','text/html');
    res.end(req.url==='/login'?'<form><input type=password><button>Sign in</button></form>':'<!doctype html><html lang=en><title>Fixture</title><main><h1>Visible</h1><button></button></main></html>');
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const baseUrl='http://127.0.0.1:'+(server.address() as {port:number}).port;
    const result=await runAudit(loadConfig({baseUrl,routes:['/','/private'],viewports:[{name:'desk',width:768,height:700}],evidence:{dataNature:'mock'},
      flows:[{name:'Read heading',route:'/',steps:[{action:'expectVisible',target:{role:'heading',name:'Visible'}}]}],
      options:{keyboard:false,axe:true,reflow:false,reducedMotion:false,screenshots:false,trace:'off'}}),{outDir:dir});
    expect(result.coverage?.pages).toEqual(expect.arrayContaining([{route:'/',viewport:'desk',status:'fail'},{route:'/private',viewport:'desk',status:'blocked'}]));
    expect(result.checks?.find(c=>c.route==='/private'&&c.check==='page-load')?.detail).toContain('Login required');
    const detail=result.checks?.find(c=>c.flow==='Read heading')?.detail;
    expect(detail).toContain('mock test data');expect(detail).not.toContain('simulat');
    const report=await writeReports(result,dir,'user-export');
    expect(JSON.parse(await readFile(report.jsonPath,'utf8')).screenshotRetention).toBe('user-export');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
},30000);
