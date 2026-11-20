import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, webkit } from 'playwright';
import { expect, it, vi } from 'vitest';
import { startConsole } from '../src/ui/server.js';
import { addProject, newRoundId, saveRound, shotsDir } from '../src/ui/store.js';
import { runCheck } from '../src/check/run.js';
import { listEvidence, inspectRemoteCode, readCodeLink } from '../src/ui/evidence.js';
import { exportBoard } from '../src/ui/board-export.js';

it('drops a mixed batch offline, reads actual Office and PDF content, and links a passage after reload',async()=>{
  const tmp=await mkdtemp(join(tmpdir(),'uxqa-import-')), before=process.env.UXQA_HOME;
  process.env.UXQA_HOME=join(tmp,'home');await mkdir(process.env.UXQA_HOME);
  await writeFile(join(process.env.UXQA_HOME,'access-settings.json'),JSON.stringify({locale:'en',onboardingDone:true,checks:[]}));
  const root=join(tmp,'source');await mkdir(root);const project=await addProject(root,'Offline sample'), server=await startConsole({port:0});
  const browser=await (process.env.UXQA_EVIDENCE_WEBKIT==='1'?webkit:chromium).launch();
  try{
    const page=await browser.newPage({viewport:{width:1180,height:850}});
    const external:string[]=[];
    await page.context().route(/^https?:\/\//,route=>{
      if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();
      external.push(new URL(route.request().url()).hostname);return route.abort();
    });
    await page.setContent('<h1>Keyboard focus must return to the form.</h1>');
    const roundId=newRoundId(),shotDir=shotsDir(project.id,roundId);await mkdir(shotDir,{recursive:true});
    const shot=join(shotDir,'view-1111111111.png'),frame=await page.screenshot({path:shot});
    await saveRound(project.id,await runCheck({source:root}),{roundId,capture:{baseUrl:'http://localhost',viewport:'desktop',pages:[],captures:{},views:[{route:'/',width:1180,image:shot}],durationMs:0,cancelled:false}});
    const content='BT /F1 12 Tf 20 50 Td (Keyboard focus must return to the form.) Tj ET';
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream'];
    let fixture='%PDF-1.4\n';const offsets=objects.map((o,i)=>{const offset=fixture.length;fixture+=(i+1)+' 0 obj\n'+o+'\nendobj\n';return offset;});
    const xref=fixture.length;fixture+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';const pdf=Buffer.from(fixture);
    const url=new URL(server.url);url.searchParams.set('project',project.id);await page.goto(url.href);
    const category=page.getByLabel('Check category',{exact:true});await category.selectOption('logic');
    const payload=await page.evaluateHandle((pdfBytes)=>{
      const f=(window as unknown as {fflate:{zipSync(x:Record<string,Uint8Array>):Uint8Array<ArrayBuffer>}}).fflate;
      const zip=(files:Record<string,string>)=>f.zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,new TextEncoder().encode(v)])));
      const dt=new DataTransfer(), add=(name:string,data:BlobPart)=>dt.items.add(new File([data],name));
      add('requirements.pdf',new Uint8Array(pdfBytes));add('contract.docx',zip({'word/document.xml':'<w:document xmlns:w="urn:word"><w:p><w:r><w:t>Must keep the original role.</w:t></w:r></w:p></w:document>'}));
      add('slides.pptx',zip({'ppt/presentation.xml':'<doc xmlns:r="urn:rel"><sldId r:id="r7"/></doc>','ppt/_rels/presentation.xml.rels':'<rels><Relationship Id="r7" Target="slides/slide4.xml"/></rels>','ppt/slides/slide4.xml':'<slide><p><t>Selected slide content</t></p></slide>'}));
      add('table.xlsx',zip({'xl/workbook.xml':'<book xmlns:r="urn:rel"><sheet name="Rules" r:id="sheet7"/></book>','xl/_rels/workbook.xml.rels':'<rels><Relationship Id="sheet7" Target="worksheets/sheet1.xml"/></rels>','xl/worksheets/sheet1.xml':'<worksheet><row r="3"><c r="B3" t="s"><v>0</v></c></row></worksheet>','xl/sharedStrings.xml':'<strings><si><t>Published limit</t></si></strings>'}));
      add('bad.docx','broken');add('rules.md','Remaining days must be positive.');add('sample.fig','design fixture');
      add('sample.sketch',zip({'pages/a.json':JSON.stringify({_class:'page',name:'Main',layers:[{_class:'artboard',do_objectID:'a',name:'Dashboard',frame:{width:1440,height:900}}]})}));
      return dt;
    },Array.from(pdf));
    await page.locator('.evidence-panel .evidence-drop').dispatchEvent('drop',{dataTransfer:payload});
    const dialog=page.getByRole('dialog');
    await dialog.getByText('bad.docx',{exact:true}).waitFor();
    await dialog.locator('article').filter({hasText:'sample.sketch'}).getByText(/Saved/).waitFor();
    await dialog.getByRole('button',{name:'Done',exact:true}).click();await page.reload();
    await category.selectOption('logic');
    await page.getByText('Sources for this check (7)',{exact:true}).click();
    const sources=await listEvidence(project);
    expect(sources.find(s=>s.name==='requirements.pdf')?.count).toBe(1);
    for(const [name,locator,quote] of [['requirements.pdf','p. 1','Keyboard focus'],['slides.pptx','Slide 1','Selected slide content'],['table.xlsx','Rules · 3','B3 Published limit'],['sample.sketch','Node a','Dashboard']]){
      const item=page.locator('.evidence-panel article').filter({has:page.getByText(name,{exact:true})});
      await item.getByRole('button',{name:'Select passage'}).click();
      await dialog.getByRole('button',{name:new RegExp(locator+'.*'+quote)}).waitFor();
      await dialog.getByRole('button',{name:'Close'}).click();
    }
    await page.locator('.evidence-panel article').filter({has:page.getByText('contract.docx',{exact:true})}).getByRole('button',{name:'Select passage'}).click();
    await dialog.getByRole('button',{name:/¶ 1 · Must keep/}).click();await dialog.getByRole('button',{name:'Save source'}).click();
    await page.getByText('contract.docx · ¶ 1',{exact:true}).click();await page.getByText('Verified against local snapshot',{exact:true}).waitFor();
    await category.selectOption('fidelity');
    await page.locator('.evidence-panel input[type=file]').setInputFiles({name:'frame.png',mimeType:'image/png',buffer:frame});
    await dialog.getByText(/Saved · PNG/).waitFor();await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByText('Sources for this check (1)',{exact:true}).click();
    await page.getByRole('button',{name:'Compare with round capture'}).click();
    await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Compare images'}).click();
    await dialog.getByText(/Matched within tolerance · 0/).waitFor();
    expect(external).toEqual([]);
  }finally{await browser.close();await server.close();if(before===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=before;await rm(tmp,{recursive:true,force:true});}
},60_000);

it('reads a real Git repository and raw text on a local network endpoint, then retains the snapshot offline',async()=>{
  const tmp=await mkdtemp(join(tmpdir(),'uxqa-git-source-')),before=process.env.UXQA_HOME;
  process.env.UXQA_HOME=join(tmp,'home'); const git=promisify(execFile);
  const repo=join(tmp,'fixture.git'), source='button { color: #ababab; }';
  await git('git',['init','-q','-b','main',repo]);await writeFile(join(repo,'style.css'),source);
  await writeFile(join(repo,'Image.tsx'),'export const Image=()=> <img src="/icon.png"/>;');
  await git('git',['-C',repo,'add','style.css','Image.tsx']);await git('git',['-C',repo,'-c','user.name=Fixture','-c','user.email=qa@example.invalid','commit','-qm','fixture']);
  await git('git',['-C',repo,'update-server-info']);
  const site=createServer(async(req,res)=>{
    const path=new URL(req.url!,'http://localhost').pathname;
    if(path==='/style.css'){res.writeHead(200,{'content-type':'text/css'});res.end(source);return;}
    if(!path.startsWith('/fixture.git/')){res.writeHead(404);res.end();return;}
    const child=spawn('git',['http-backend'],{env:{...process.env,GIT_PROJECT_ROOT:tmp,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:path.replace('/fixture.git/','/fixture.git/.git/'),REQUEST_METHOD:req.method,QUERY_STRING:new URL(req.url!,'http://localhost').search.slice(1),CONTENT_TYPE:req.headers['content-type'] || ''}});
    req.pipe(child.stdin);const buffers:Buffer[]=[];
    for await(const chunk of child.stdout)buffers.push(chunk);
    const output=Buffer.concat(buffers),split=output.indexOf('\r\n\r\n');
    if(split<0){res.writeHead(500);res.end();return;}
    const head=output.subarray(0,split).toString();
    res.writeHead(Number(head.match(/Status: (\d+)/i)?.[1] || 200),{'content-type':head.match(/Content-Type: ([^\r\n]+)/i)?.[1] || 'application/octet-stream'});res.end(output.subarray(split+4));
  });await new Promise<void>(resolve=>site.listen(0,'127.0.0.1',resolve));
  try{
    const address=site.address();if(!address || typeof address==='string')throw Error('No endpoint');
    const url='http://127.0.0.1:'+address.port, project=await addProject(tmp);
    const file=await readCodeLink(project,{url:url+'/style.css',suites:['components']});
    expect(file.count).toBe(1);
    const scanned=await inspectRemoteCode(project,{url:url+'/fixture.git',suites:['components']});
    expect(scanned.revision).toMatch(/^[a-f0-9]{7,}$/);expect(scanned.count).toBeGreaterThan(0);
    expect(scanned.diagnostics).toContainEqual(expect.objectContaining({rule:'basic/img-alt',location:'Image.tsx:1'}));
    await expect(inspectRemoteCode(project,{url:url+'/missing.git',suites:['components']})).rejects.toThrow();
    expect((await listEvidence(project)).map(s=>s.id).sort()).toEqual([file.id,scanned.id].sort());
  }finally{await new Promise<void>(resolve=>site.close(()=>resolve()));if(before===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=before;await rm(tmp,{recursive:true,force:true});}
});

it('sends board credentials only to the selected official API and stores the returned frame',async()=>{
  const tmp=await mkdtemp(join(tmpdir(),'uxqa-export-')), before=process.env.UXQA_HOME;
  process.env.UXQA_HOME=tmp;
  const project=await addProject(tmp);
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4V8AAAAASUVORK5CYII=','base64');
  const transport=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const url=new URL(String(input)), headers=new Headers(init?.headers);
    if(url.hostname==='api.figma.com'){
      expect(headers.get('x-figma-token')).toBe('fixture-only');expect(url.searchParams.get('ids')).toBe('1:2');
      return Response.json({images:{'1:2':'https://export.invalid/frame.png'}});
    }
    if(url.hostname==='api.canva.com'){
      expect(headers.get('authorization')).toBe('Bearer fixture-only');
      if(init?.method==='POST'){expect(JSON.parse(String(init.body)).format.pages).toEqual([2]);return Response.json({job:{status:'in_progress',id:'job'}});}
      return Response.json({job:{status:'success',urls:['https://export.invalid/frame.png']}});
    }
    expect(url.hostname).toBe('export.invalid');expect([...headers.keys()]).toEqual([]);return new Response(image);
  });
  try{
    for(const url of ['https://www.figma.com/design/example/Board?node-id=1-2','https://www.canva.com/design/example/view']){
      const result=await exportBoard(project,{url,page:2,credential:'fixture-only',suites:['fidelity']});expect(result.image).toMatch(/^[a-f0-9]{64}$/);
    }
    const saved=await listEvidence(project);expect(saved.length).toBe(2);expect(JSON.stringify(saved)).not.toContain('fixture-only');
  }finally{transport.mockRestore();if(before===undefined)delete process.env.UXQA_HOME;else process.env.UXQA_HOME=before;await rm(tmp,{recursive:true,force:true});}
});
