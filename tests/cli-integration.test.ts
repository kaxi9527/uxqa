import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const cli = resolve('src/cli.ts');

describe('CLI output and exit contracts', () => {
  it('returns usage exit 2 and refuses to overwrite prior evidence', async () => {
    await expect(exec(process.execPath,['--import','tsx',cli,'components','--typo'])).rejects.toMatchObject({code:2});
    const temp = await mkdtemp(join(tmpdir(),'uxqa-cli-'));
    try {
      const existing = join(temp,'keep.txt');
      await writeFile(existing,'keep');
      await expect(exec(process.execPath,['--import','tsx',cli,'components','--source',resolve('examples/component-source'),'--out',temp])).rejects.toMatchObject({code:2});
      expect(await readFile(existing,'utf8')).toBe('keep');
    } finally { await rm(temp,{recursive:true,force:true}); }
  },20_000);
  it('runs a source-only audit with no browser and preserves JSON evidence', async () => {
    const temp = await mkdtemp(join(tmpdir(),'uxqa-cli-source-'));
    try {
      const result = await exec(process.execPath,['--import','tsx',cli,'components','--source',resolve('examples/component-source'),'--out',temp]);
      expect(result.stdout).toContain('Component audit complete');
      const report = JSON.parse(await readFile(join(temp,'components.json'),'utf8'));
      expect(report.source.duplicates.length).toBeGreaterThan(0);
      expect(report.coverage).toEqual([]);
      expect(report.tools.map((tool: {name:string}) => tool.name)).toEqual(['jscpd','react-scanner','project-wallace']);
    } finally { await rm(temp,{recursive:true,force:true}); }
  },20_000);

  it('can scan the current product directory while keeping default artifacts outside it', async () => {
    const temp = await mkdtemp(join(tmpdir(),'uxqa-cli-product-'));
    try {
      const product = join(temp,'product');
      const reports = join(temp,'tool-artifacts');
      await mkdir(product);
      await writeFile(join(product,'Card.jsx'),'export const Card = () => <article>Record</article>;');
      const result = await exec(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),cli,'components','--source','.'],{
        cwd:product,env:{...process.env,UXQA_OUTPUT_ROOT:reports},
      });
      expect(result.stdout).toContain('Component audit complete');
      expect(await readdir(product)).toEqual(['Card.jsx']);
      expect((await readdir(reports)).length).toBe(1);
    } finally { await rm(temp,{recursive:true,force:true}); }
  },20_000);
});
