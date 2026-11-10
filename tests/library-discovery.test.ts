import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverLibrary } from '../src/library/discovery.js';
import { appendCatalog, readCatalog } from '../src/library/catalog.js';

describe('product library discovery', () => {
  it('finds the product library inside the nearest package boundary and reads existing entries', async () => {
    const root = await mkdtemp(join(tmpdir(),'uxqa-library-'));
    try {
      await writeFile(join(root,'package.json'),JSON.stringify({name:'product-a'}));
      const library = join(root,'src/component-library');
      await mkdir(library,{recursive:true});
      await writeFile(join(library,'component-manifest.json'),JSON.stringify({owner:'keep',components:[{id:'button',name:'Button'}]}));
      const result = await discoverLibrary(join(root,'src'));
      expect(result.status).toBe('found');
      expect(result.productId).toBe('product-a');
      expect(result.library?.entries).toEqual([{id:'button',name:'Button'}]);
      await mkdir(join(root,'nested/src'),{recursive:true});
      await writeFile(join(root,'nested/package.json'),JSON.stringify({name:'nested-product'}));
      expect((await discoverLibrary(join(root,'nested/src'))).status).toBe('missing');
    } finally { await rm(root,{recursive:true,force:true}); }
  });

  it('blocks ambiguous targets and does not consider arbitrary components directories a registered library', async () => {
    const root = await mkdtemp(join(tmpdir(),'uxqa-library-ambiguous-'));
    try {
      await writeFile(join(root,'package.json'),JSON.stringify({name:'product-b'}));
      await mkdir(join(root,'src/components'),{recursive:true});
      expect((await discoverLibrary(root)).status).toBe('missing');
      for (const path of ['src/component-library','packages/ui']) {
        await mkdir(join(root,path),{recursive:true});
        await writeFile(join(root,path,'component-manifest.json'),'{"components":[]}');
      }
      expect((await discoverLibrary(root)).status).toBe('ambiguous');
      expect((await discoverLibrary(root,join(root,'packages/ui'))).status).toBe('found');
    } finally { await rm(root,{recursive:true,force:true}); }
  });

  it('uses an explicit product declaration and refuses library symlinks into another product', async () => {
    const root=await mkdtemp(join(tmpdir(),'uxqa-library-declared-'));
    try {
      await writeFile(join(root,'package.json'),'{"name":"internal-package"}');
      await mkdir(join(root,'.uxqa'));
      await mkdir(join(root,'design-system'));
      await writeFile(join(root,'design-system/registry.json'),'{"components":[]}');
      await writeFile(join(root,'.uxqa/library.json'),JSON.stringify({productId:'customer-product',root:'design-system',catalog:'design-system/registry.json'}));
      const result=await discoverLibrary(root);
      expect(result).toMatchObject({status:'found',productId:'customer-product'});
      expect((await discoverLibrary(root,join(root,'design-system'))).status).toBe('found');
      const other=join(root,'other');await mkdir(other);
      await expect(discoverLibrary(root,other)).rejects.toThrow(/conflict/i);
      await symlink('/tmp',join(root,'foreign'));
      await expect(discoverLibrary(root,join(root,'foreign'))).rejects.toThrow(/boundary|symlink/i);
    } finally {await rm(root,{recursive:true,force:true});}
  });

  it('does not mistake shadcn configuration for a library catalog',async()=>{
    const root=await mkdtemp(join(tmpdir(),'uxqa-library-config-'));
    try {
      await writeFile(join(root,'package.json'),'{"name":"product-ui"}');
      await writeFile(join(root,'components.json'),'{"$schema":"https://ui.shadcn.com/schema.json","style":"default","aliases":{"ui":"@/components/ui"}}');
      await mkdir(join(root,'src/components'),{recursive:true});
      await writeFile(join(root,'src/components/component-manifest.json'),'{"components":[]}');
      expect((await discoverLibrary(root)).status).toBe('found');
    } finally {await rm(root,{recursive:true,force:true});}
  });
});

describe('native catalog adapters', () => {
  it('appends JSON entries without dropping unrelated records or fields', async () => {
    const root = await mkdtemp(join(tmpdir(),'uxqa-catalog-'));
    try {
      const path = join(root,'catalog.json');
      await writeFile(path,'{"owner":"keep","components":[{"id":"old","name":"Existing"}]}');
      const catalog = await readCatalog(path);
      const updated = appendCatalog(catalog,{id:'new',name:'RecordCard',description:'Records',implementation:['src/ui/RecordCard.tsx'],consumers:['src/Page.tsx'],states:['default'],variants:['compact'],anatomy:['body'],behavior:['activate'],accessibility:['keyboard'],usage:['records'],antiUsage:['menus'],props:[]},'specs/record-card.md');
      const json = JSON.parse(updated);
      expect(json.owner).toBe('keep');
      expect(json.components).toHaveLength(2);
      expect(json.components[0]).toEqual({id:'old',name:'Existing'});
      expect(() => appendCatalog(catalog,{...json.components[1],id:'old'},'specs/old.md')).toThrow(/already|duplicate/i);
    } finally { await rm(root,{recursive:true,force:true}); }
  });

  it('appends to a SynNovator-style TS array while preserving source comments and existing records', async () => {
    const root = await mkdtemp(join(tmpdir(),'uxqa-native-ts-'));
    try {
      const path = join(root,'component-manifest.ts');
      const original = "// User comment\nexport const COMPONENT_AUTHORITY = Object.freeze([\n  { id: 'atom.button', name: 'Button', status: 'approved' },\n]);\nexport const SENTINEL = 'preserve';\n";
      await writeFile(path,original);
      const catalog = await readCatalog(path);
      const updated = appendCatalog(catalog,{id:'atom-group.record-card',name:'RecordCard',description:'Records',implementation:['src/component-library/RecordCard.tsx'],consumers:['src/Page.tsx'],states:['default'],variants:[],anatomy:['body'],behavior:['activate'],accessibility:['keyboard'],usage:['records'],antiUsage:[],props:[]},'specs/record-card.md');
      expect(updated).toContain('// User comment');
      expect(updated).toContain("{ id: 'atom.button', name: 'Button', status: 'approved' }");
      expect(updated).toContain("export const SENTINEL = 'preserve'");
      expect(updated).toContain('candidate-needs-evidence');
      await writeFile(path,updated);
      expect((await readCatalog(path)).entries).toHaveLength(2);
      expect(await readFile(path,'utf8')).toContain('specs/record-card.md');
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
