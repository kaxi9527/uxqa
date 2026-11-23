import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runBusinessJourney } from '../src/business-journey.js';

const setting={kind:'setting-propagation',route:'/settings',field:'#field',value:'57',publish:'#publish',saved:'#saved',
  controlRoute:'/control',control:'#value',readers:[{route:'/consumer',selector:'#value'}]};
const draft={kind:'return-state',route:'/edit',field:'#draft',identity:'#id',value:'draft number nine',awayRoute:'/home',awayReady:'#home',outcome:'retain'};
const assignment={kind:'role-outcomes',route:'/assign',open:'#open',preview:'#preview',confirm:'#confirm',cancel:'#cancel',rows:'[data-item]',
  total:'data-total',keys:'data-item',recipient:'data-recipient',recipients:['A','B'].map(id=>({id,route:'/role/'+id,identity:'#identity',list:'#tasks'}))};

it('checks observed changes, keyed recipients and interrupted edits against working, broken and inconclusive implementations', async()=>{
  let mode='correct',value='31',commits=0,cancelled=false,allocations=['old-A','old-B'];
  const list=(id:string,rows:string[])=>'<div id="'+id+'" data-total="'+rows.length+'">'+rows.map(k=>'<p data-item="'+k.slice(0,-2)+'" data-recipient="'+k.slice(-1)+'">'+k+'</p>').join('')+'</div>';
  const site=createServer(async(req,res)=>{
    const path=req.url!;
    if(path.startsWith('/write/')){value=path.slice(7);commits++;res.end();return;}
    if(path==='/commit'||path==='/cancel'){
      if(path==='/cancel')cancelled=true;
      if(path==='/commit'||mode==='cancel-leak')allocations=mode==='swapped'||mode==='new-preview'?['next-B','other-A']:['next-A','other-B'];
      res.end();return;
    }
    if(mode==='redirect' && path==='/home'){res.writeHead(302,{location:'/edit'});res.end();return;}
    res.setHeader('content-type','text/html;charset=utf-8');
    let body='';
    if(path==='/settings')body='<input id="field" value="'+value+'"><button id="publish">Publish</button><p id="saved" hidden>Saved</p><script>publish.onclick=async()=>{await fetch("/write/"+field.value);saved.hidden=false}</script>';
    if(path==='/consumer'||path==='/control')body='<p id="value">'+(path==='/consumer' && mode!=='stale' || path==='/control'&&mode==='leak'?value:'31')+'</p>';
    if(path==='/edit')body='<p id="id">'+(mode==='wrong-object'?'will-change':'record-3')+'</p><input id="draft" value="seed"><script>if(sessionStorage.edited){'+(mode==='wrong-object'?'id.textContent="different";':'')+(mode==='lost'?'':'draft.value=sessionStorage.edited;')+'}draft.oninput=()=>sessionStorage.edited=draft.value</script>';
    if(path==='/home')body='<main id="home">Overview</main>';
    if(path==='/assign'||path==='/plan'){
      const rows=mode==='unchanged'?allocations:mode==='new-preview'&&cancelled?['next-B','other-A']:['next-A','other-B'];
      body='<button id="open">Preview</button><section hidden>'+list('preview',rows)+'<button id="commitButton">Confirm</button><button id="cancel">Cancel</button></section><script>const panel=document.querySelector("section");document.getElementById("open").onclick=()=>panel.hidden=false;for(const b of panel.querySelectorAll("button"))b.onclick=async()=>{await fetch(b.id==="cancel"?"/cancel":"/commit");panel.hidden=true}</script>';
      if(mode==='new-page')body+=path==='/assign'?'<script>document.getElementById("open").onclick=()=>location.href="/plan"</script>':'<script>document.querySelector("section").hidden=false</script>';
    }
    if(path.startsWith('/role/')){const id=path.slice(-1);body='<b id="identity">'+(mode==='wrong-role'?'anonymous':id)+'</b>'+list('tasks',allocations.filter(k=>k.endsWith(id)));}
    res.end('<!doctype html><html lang="en"><title>Sample</title><main>'+body+'</main></html>');
  });
  await new Promise<void>(done=>site.listen(0,'127.0.0.1',done));
  const baseUrl='http://127.0.0.1:'+(site.address() as {port:number}).port;
  const browser=await chromium.launch();
  try{
    async function check(binding:object,variant:string){
      mode=variant;value=variant==='same'?'57':'31';commits=0;cancelled=false;allocations=['old-A','old-B'];
      const [plan]=loadConfig({baseUrl,requirementChecks:[{...binding,requirement:'Selected requirement'}]}).journeys!;
      return runBusinessJourney(browser,baseUrl,plan);
    }
    for(const config of [setting,{...assignment,confirm:'#commitButton'},draft]){
      const phases=await check(config,'correct');expect(phases.map(p=>[p.phase,p.status]).filter(v=>v[1]!=='pass')).toEqual([]);
    }
    for(const [config,variant] of [[setting,'stale'],[setting,'leak'],[{...assignment,confirm:'#commitButton'},'swapped'],[{...assignment,confirm:'#commitButton'},'cancel-leak'],[draft,'lost']] as const){
      expect((await check(config,variant)).some(p=>p.status==='fail'),variant).toBe(true);
    }
    expect((await check({...assignment,confirm:'#commitButton'},'new-preview')).every(p=>p.status==='pass')).toBe(true);
    const separatePage=await check({...assignment,confirm:'#commitButton',previewRoute:'/plan'},'new-page');
    expect(separatePage.filter(p=>p.status!=='pass').map(p=>[p.phase,p.status,p.detail])).toEqual([]);
    for(const [config,variant] of [[setting,'same'],[{...assignment,confirm:'#commitButton'},'wrong-role'],[{...assignment,confirm:'#commitButton'},'unchanged'],[draft,'wrong-object'],[draft,'redirect']] as const){
      const phases=await check(config,variant);
      expect(phases.some(p=>p.status==='not-verified'),variant).toBe(true);
      expect(phases.some(p=>p.status==='fail')).toBe(false);
      expect(commits).toBe(0);expect(allocations).toEqual(['old-A','old-B']);
    }
    const restore=await check({...draft,outcome:'restore'},'lost');expect(restore.at(-1)?.status).toBe('pass');
  }finally{await browser.close();await new Promise<void>(done=>site.close(()=>done()));}
},90000);
