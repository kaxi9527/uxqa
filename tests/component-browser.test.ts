import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { auditComponents } from '../src/components/audit.js';
import { writeComponentReports } from '../src/components/reports.js';

describe('real cross-page browser audit', () => {
  let server: Server;
  let baseUrl: string;
  let output: string;
  beforeAll(async () => {
    output = await mkdtemp(join(tmpdir(),'uxqa-browser-'));
    server = createServer((request,response) => {
      response.setHeader('content-type','text/html');
      if (request.url === '/protected' && !request.headers.cookie?.includes('session=fixture')) {
        response.writeHead(401); response.end('Authentication required'); return;
      }
      response.end(`<!doctype html><html lang="en"><head><title>Fixture</title>
<style>body{margin:24px;font-family:Arial}article{padding:16px;background:${request.url === '/a' ? 'white':'#eee'};border:1px solid #aaa}button{padding:8px}dialog{padding:12px}</style></head>
<body><main><article><h2>Different content</h2><p>Card details</p><button type="button">Save</button></article>
<button type="button" onclick="document.querySelector('dialog').showModal()">Open settings</button>
<dialog><h2>Settings</h2><button type="button">Close</button></dialog></main></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve,reject) => server.close((error) => error ? reject(error):resolve()));
    await rm(output,{recursive:true,force:true});
  });

  it('finds cards across two routes, captures dynamic dialog state, and writes escaped evidence reports', async () => {
    const config = loadConfig({baseUrl,name:'<script>unsafe</script>',routes:['/a','/b'],
      viewports:[{name:'desktop',width:1200,height:800}],
      flows:[{name:'open settings',steps:[{action:'click',target:{role:'button',name:'Open settings'}}]}],
    });
    const audit = await auditComponents(config,{outDir:output,designTokens:false});
    expect(audit.status).toBe('complete');
    expect(audit.candidates).toEqual(expect.arrayContaining([expect.objectContaining({family:'card',routes:['/a','/b']})]));
    expect(audit.observations.some((entry) => entry.family === 'dialog' && entry.state === 'flow:open settings')).toBe(true);
    const screenshot = audit.candidates.find((entry) => entry.family === 'card')?.instances[0].screenshot;
    expect(screenshot).toBeTruthy();
    expect((await readFile(screenshot!)).subarray(0,4).toString('hex')).toBe('89504e47');
    const reports = await writeComponentReports(audit,output);
    const html = await readFile(reports.htmlPath,'utf8');
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(html).not.toContain('<script>unsafe</script>');
  }, 30_000);

  it('runs the installed Dembrandt extractor with the existing browser revision', async () => {
    const config = loadConfig({baseUrl,routes:['/a'],viewports:[{name:'desktop',width:1200,height:800}]});
    const audit = await auditComponents(config,{outDir:join(output,'tokens'),designTokens:true});
    expect(audit.tools).toEqual(expect.arrayContaining([expect.objectContaining({name:'dembrandt',version:'0.38.0',status:'complete'})]));
    const evidence = audit.tools.find((entry) => entry.name === 'dembrandt')?.artifact;
    const tokens = JSON.parse(await readFile(evidence!,'utf8'));
    expect(tokens).toHaveProperty('colors');
    expect(tokens).toHaveProperty('components');
  },75_000);

  it('marks failed states incomplete and still emits other route evidence', async () => {
    const config = loadConfig({baseUrl,routes:['/a','/b'],viewports:[{name:'desktop',width:1200,height:800}],
      flows:[{name:'invalid target',steps:[{action:'click',target:{css:'['}}]}]});
    const audit = await auditComponents(config,{outDir:join(output,'partial'),designTokens:false});
    expect(audit.status).toBe('partial');
    expect(audit.coverage.filter((entry) => entry.status==='failed')).toHaveLength(2);
    expect(audit.candidates.some((entry) => entry.family==='card')).toBe(true);
  });

  it('uses the configured external storage state for protected product pages', async () => {
    const storageState = join(output,'auth.storage-state.json');
    await writeFile(storageState,JSON.stringify({cookies:[{name:'session',value:'fixture',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]}));
    const config = loadConfig({baseUrl,storageState,routes:['/protected'],viewports:[{name:'desktop',width:1200,height:800}]});
    const audit = await auditComponents(config,{outDir:join(output,'authenticated'),designTokens:false});
    expect(audit.status).toBe('complete');
    expect(audit.observations.some((entry) => entry.family==='card')).toBe(true);
  });
});
