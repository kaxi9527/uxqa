import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const exec=promisify(execFile);
const cli=resolve('src/cli.ts');
const loader=resolve('node_modules/tsx/dist/loader.mjs');
describe('library workflow CLI',()=>{
  it('reports discovery and blocks component planning without a real library',async()=>{
    const root=await mkdtemp(join(tmpdir(),'uxqa-lib-cli-'));
    try {
      const product=join(root,'product');await mkdir(product);
      await writeFile(join(product,'package.json'),'{"name":"product-cli"}');
      await expect(exec(process.execPath,['--import',loader,cli,'library','--source',product,'--out',join(root,'missing')])).rejects.toMatchObject({code:1});
      const report=JSON.parse(await readFile(join(root,'missing/library.json'),'utf8'));
      expect(report.status).toBe('missing');
      await expect(exec(process.execPath,['--import',loader,cli,'component-plan','--source',product,'--definition',join(root,'missing-definition.json'),'--out',join(root,'blocked')])).rejects.toMatchObject({code:2});
      const library=join(product,'src/component-library');await mkdir(library,{recursive:true});
      await writeFile(join(library,'component-manifest.json'),'{"components":[{"id":"button","name":"Button"}]}');
      const result=await exec(process.execPath,['--import',loader,cli,'library','--source',product,'--out',join(root,'found')]);
      expect(result.stdout).toContain('Library: found');
      expect(JSON.parse(await readFile(join(root,'found/library.json'),'utf8')).library.entries).toHaveLength(1);
    } finally {await rm(root,{recursive:true,force:true});}
  },20_000);
});
