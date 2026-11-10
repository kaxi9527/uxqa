import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditSource } from '../src/components/source.js';

describe('source analysis with installed tools', () => {
  it('finds real code clones and existing React component usage without editing source', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'uxqa-source-'));
    try {
      const root = join(temp, 'product');
      await mkdir(root);
      const code = `import { Button } from '@acme/ui';
export function Actions() {
  const label = 'Save';
  const active = true;
  const size = 'medium';
  return (
    <section>
      <h2>Actions</h2>
      <p>Choose an action</p>
      <Button size={size} disabled={!active}>{label}</Button>
    </section>
  );
}
`;
      await writeFile(join(root, 'one.tsx'), code);
      await writeFile(join(root, 'two.tsx'), code);
      await mkdir(join(root, 'node_modules'));
      await writeFile(join(root, 'node_modules', 'ignored.tsx'), code);
      await symlink(join(root, 'one.tsx'), join(root, 'linked.tsx'));
      const result = await auditSource(root, join(temp, 'evidence'));
      expect(result.status).toBe('complete');
      expect(result.duplicates.length).toBeGreaterThan(0);
      expect(result.components).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Button', module: '@acme/ui', count: 2 }),
      ]));
      expect(result.components.some((component) => component.name==='section' || component.name==='h2')).toBe(false);
      const button = result.components.find((component) => component.name==='Button');
      expect(button?.fileCount).toBe(2);
      expect(button?.propPatterns.find((pattern) => pattern.prop==='size')?.dynamic).toBe(2);
      expect(result.files).toEqual(['one.tsx', 'two.tsx']);
      expect(await readFile(join(root, 'one.tsx'), 'utf8')).toBe(code);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }, 60_000);

  it('rejects missing directories and artifacts inside the source tree', async () => {
    await expect(auditSource('/nonexistent/uxqa-source', '/tmp/uxqa-output')).rejects.toThrow(/source/i);
    const temp = await mkdtemp(join(tmpdir(), 'uxqa-overlap-'));
    try {
      await expect(auditSource(temp, join(temp, 'report'))).rejects.toThrow(/inside|overlap/i);
    } finally { await rm(temp, { recursive: true, force: true }); }
  });

  it('marks parser failures incomplete instead of claiming a clean component inventory', async () => {
    const temp = await mkdtemp(join(tmpdir(),'uxqa-parse-'));
    try {
      const root = join(temp,'product');
      await mkdir(root);
      await writeFile(join(root,'broken.tsx'),'export function Broken( { return <Button>');
      const result = await auditSource(root,join(temp,'evidence'));
      expect(result.status).toBe('partial');
      expect(result.tools).toEqual(expect.arrayContaining([expect.objectContaining({name:'react-scanner',status:'failed'})]));
    } finally { await rm(temp,{recursive:true,force:true}); }
  });

  it('recognizes JSX in .js files and counts aliases of the same imported component together', async () => {
    const temp = await mkdtemp(join(tmpdir(),'uxqa-alias-'));
    try {
      const root = join(temp,'product');
      await mkdir(root);
      await writeFile(join(root,'one.js'),"import { Button } from '@acme/ui'; export const One = () => <Button>Save</Button>;");
      await writeFile(join(root,'two.jsx'),"import { Button as Action } from '@acme/ui'; export const Two = () => <Action>Continue</Action>;");
      const result = await auditSource(root,join(temp,'evidence'));
      expect(result.components.filter((component) => component.module==='@acme/ui')).toEqual([
        expect.objectContaining({name:'Button',count:2}),
      ]);
    } finally { await rm(temp,{recursive:true,force:true}); }
  });

  it('analyzes CSS with Wallace and redacts sensitive prop values in retained scanner evidence', async () => {
    const temp = await mkdtemp(join(tmpdir(),'uxqa-css-source-'));
    try {
      const root = join(temp,'product');
      await mkdir(root);
      const css = ':root{--brand:#1269aa}.card{color:var(--brand);padding:16px}';
      await writeFile(join(root,'styles.css'),css);
      await writeFile(join(root,'form.tsx'),"import { Form } from '@acme/ui'; export const App = () => <Form apiKey='fixture-private-value' />;");
      const result = await auditSource(root,join(temp,'evidence'));
      expect(result.css.analyses[0].summary).toMatchObject({definedTokens:1,usedTokens:1,spacingValues:['16px']});
      const artifact = result.tools.find((tool) => tool.name==='react-scanner')?.artifact;
      expect(await readFile(artifact!,'utf8')).not.toContain('fixture-private-value');
      expect(await readFile(join(root,'styles.css'),'utf8')).toBe(css);
    } finally { await rm(temp,{recursive:true,force:true}); }
  });

  it('keeps namespace members separate and merges aliases of one default import', async () => {
    const temp = await mkdtemp(join(tmpdir(),'uxqa-imports-'));
    try {
      const root = join(temp,'product');
      await mkdir(root);
      await writeFile(join(root,'one.tsx'),"import Button from '@acme/button'; import * as UI from '@acme/ui'; export const One = () => <><Button/><UI.Card/><UI.Button/></>;");
      await writeFile(join(root,'two.tsx'),"import Action from '@acme/button'; import * as Kit from '@acme/ui'; export const Two = () => <><Action/><Kit.Card/></>;");
      const result = await auditSource(root,join(temp,'evidence'));
      const defaultButton = result.components.find((component) => component.module==='@acme/button');
      expect(result.status,JSON.stringify(result.tools)).toBe('complete');
      expect(defaultButton?.count,JSON.stringify(result.components.map(({name,module,count,aliases,exportName}) => ({name,module,count,aliases,exportName})))).toBe(2);
      expect(defaultButton?.name).not.toBe('default');
      expect(result.components.filter((component) => component.module==='@acme/ui').map((component) => component.count).sort()).toEqual([1,2]);
    } finally { await rm(temp,{recursive:true,force:true}); }
  });
});
