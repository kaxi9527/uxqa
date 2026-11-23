import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runAudit } from '../src/runner.js';
import { writeReports } from '../src/report-writer.js';

it('accepts a documented non-applicable scenario and rejects conflicting or incomplete bindings', () => {
  const input = {baseUrl:'http://localhost:3000', routes:['/'], notApplicable:[{check:'language-entry',reason:'Single-language application'}]};
  expect(loadConfig(input).notApplicable).toEqual(input.notApplicable);
  const binding = {type:'language-entry',route:'/',switcher:{css:'#en'},lang:'en',entry:{role:'link',name:'Skip'}};
  expect(() => loadConfig({...input,scenarios:[binding]})).toThrow(/not applicable/);
  expect(() => loadConfig({...input,scenarios:[{...binding,entry:{role:'link'}}]})).toThrow(/accessible name/);
});

it('distinguishes observed regressions, working interactions, and missing prerequisites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uxqa-scenarios-'));
  const server = createServer((req, res) => {
    if (req.url === '/items') { res.end('Items loaded'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const broken = req.url === '/broken';
    res.end(`<!doctype html><html lang="zh"><title>Demo</title><body>
      <a href="#main">跳到主要内容</a><main id="main"><button id="lang">English</button>
      <button id="save">Save</button><button id="next">Continue</button><p hidden id="saved">Saved</p>
      <p id="error" hidden>Retry needed</p><p id="ready" hidden></p><button id="retry">Retry</button></main>
      <script>
      async function load(){const r=await fetch('/items'); if(!r.ok){error.hidden=false;return}
      ready.textContent=await r.text();ready.hidden=false;if(!${broken})error.hidden=true}
      retry.onclick=load;load();
      save.onclick=()=>{saved.hidden=false;if(!${broken})next.focus();else save.blur()};
      lang.onclick=()=>{document.documentElement.lang='en';if(!${broken})document.querySelector('a').textContent='Skip to main content'};
      </script></body></html>`);
  });
  try {
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const css = (value: string) => ({css:value});
    const scenarios = ['/working','/broken'].flatMap(route => [
      {type:'failure-recovery',route,request:'**/items',error:css('#error'),ready:css('#ready'),retry:css('#retry')},
      {type:'save-focus',route,save:css('#save'),saved:css('#saved'),continuation:css('#next')},
      {type:'language-entry',route,switcher:css('#lang'),lang:'en',entry:{role:'link',name:'Skip to main content'}},
    ]);
    const base = {baseUrl:'http://127.0.0.1:'+address.port,viewports:[{name:'desktop',width:900,height:700}],
      options:{keyboard:false,axe:false,reflow:false,reducedMotion:false,screenshots:false,trace:'off'}};
    const run = await runAudit(loadConfig({...base,routes:['/working','/broken'],scenarios}),{outDir:dir});
    for (const type of ['failure-recovery','save-focus','language-entry']) {
      expect(run.checks.find(c=>c.route==='/working' && c.check===type)?.status).toBe('pass');
      expect(run.checks.find(c=>c.route==='/broken' && c.check===type)?.status).toBe('fail');
    }
    const unbound = await runAudit(loadConfig({...base,routes:['/working'],scenarios:[{
      type:'save-focus',route:'/working',save:css('#save'),saved:css('#main'),continuation:css('#next')
    }]}),{outDir:dir});
    expect(unbound.checks.find(c=>c.check==='save-focus')?.status).toBe('blocked');
    expect(unbound.checks.find(c=>c.check==='language-entry')?.status).toBe('not-verified');
    expect(unbound.findings.filter(f=>f.kind==='flow')).toHaveLength(0);
    const paths = await writeReports(unbound,dir);
    expect(JSON.parse(await readFile(paths.jsonPath,'utf8')).coverage.pages[0].route).toBe('/working');
    expect(await readFile(paths.markdownPath,'utf8')).toContain('No project scenario binding');
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(dir,{recursive:true,force:true});
  }
}, 100_000);
