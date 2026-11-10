import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runAudit } from '../src/runner.js';

describe('QA evidence and retry semantics', () => {
  it('waits for visible results and keeps clean screenshots as artifacts rather than issues', async () => {
    const server = createServer((_request,response) => {
      response.end('<!doctype html><html><body><main><button onclick="setTimeout(() => document.getElementById(\'saved\').hidden=false,250)">Save</button><p id="saved" hidden>Saved</p></main></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
    const output = await mkdtemp(join(tmpdir(),'uxqa-qa-'));
    try {
      const config = loadConfig({baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`,
        viewports:[{name:'desktop',width:1000,height:700}], options:{axe:false},
        flows:[{name:'save',steps:[{action:'click',target:{role:'button',name:'Save'}},{action:'expectVisible',target:{text:'Saved'}}]}]});
      const result = await runAudit(config,{outDir:output});
      expect(result.findings).toEqual([]);
      expect(result.artifacts.some((entry) => entry.endsWith('.png'))).toBe(true);
      expect(result.artifacts.some((entry) => entry.includes('-flow-') && entry.endsWith('.png'))).toBe(true);
      expect(result.artifacts.some((entry) => entry.endsWith('.trace.zip'))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(output,{recursive:true,force:true});
    }
  },20_000);
});
