import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { inside } from '../components/source.js';
import { boundPath } from './paths.js';
import { readCatalog } from './catalog.js';
import type { LibraryDiscovery, LibraryTarget } from './types.js';

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
export async function discoverLibrary(source: string, explicitLibrary?: string): Promise<LibraryDiscovery> {
  source = await realpath(resolve(source));
  if (!(await lstat(source)).isDirectory()) throw new Error('Library discovery source must be a directory');
  let productRoot = source;
  while (!(await exists(join(productRoot,'package.json')))) {
    const parent = dirname(productRoot);
    if (parent===productRoot) { productRoot=source;break; }
    productRoot=parent;
  }
  const pkgPath = join(productRoot,'package.json');
  const pkg = await exists(pkgPath) ? JSON.parse(await readFile(pkgPath,'utf8')):{};
  const result: LibraryDiscovery = {status:'missing',productRoot,productId:typeof pkg.name==='string' ? pkg.name:basename(productRoot),candidates:[],issues:[]};
  const declarationPath = join(productRoot,'.uxqa/library.json');
  let declaration: {productId:string;root:string;catalog:string}|undefined;
  if (await exists(declarationPath)) {
    const raw=JSON.parse(await readFile(await boundPath(productRoot,'.uxqa/library.json'),'utf8'));
    if (typeof raw.productId!=='string' || typeof raw.root!=='string' || typeof raw.catalog!=='string') throw new Error('Invalid .uxqa/library.json: productId, root, catalog required');
    declaration=raw;result.productId=raw.productId;
  }
  let catalogPaths: string[]=[];
  if (explicitLibrary) {
    const root = await boundPath(productRoot,resolve(explicitLibrary),'directory');
    if (declaration) {
      const declaredRoot=await boundPath(productRoot,declaration.root,'directory');
      if (declaredRoot!==root) throw new Error('Selected library conflicts with the declared product library');
      const catalog=await boundPath(root,resolve(productRoot,declaration.catalog));
      catalogPaths=[catalog];
    } else catalogPaths=['component-manifest.json','component-manifest.ts','catalog.json','components.json'].map((file) => join(root,file));
  } else if (declaration) {
    const root = await boundPath(productRoot,declaration.root,'directory');
    const catalog = await boundPath(productRoot,declaration.catalog);
    if (!inside(root,catalog)) throw new Error('Declared catalog is not in the product library');
    catalogPaths=[catalog];
  } else {
    const roots = [productRoot,...['src/component-library','src/components','src/components/ui','src/design-system','src/ui','component-library','components/ui','design-system','packages/ui','packages/components','packages/design-system'].map((path) => join(productRoot,path))];
    catalogPaths=roots.flatMap((root) => ['component-manifest.json','component-manifest.ts','catalog.json','components.json'].map((file) => join(root,file)));
  }
  for (const path of catalogPaths) {
    if (!(await exists(path))) continue;
    try {
      await boundPath(productRoot,path);
      if (path.endsWith('components.json')) {
        const config=JSON.parse(await readFile(path,'utf8'));
        if (typeof config.$schema==='string' && config.$schema.startsWith('https://ui.shadcn.com/') && !Array.isArray(config.components)) continue;
      }
      const catalog = await readCatalog(path);
      const root = await realpath(dirname(path));
      const target: LibraryTarget = {root,catalog:catalog.path,format:catalog.format,catalogHash:catalog.hash,entries:catalog.entries};
      if (!result.candidates.some((candidate) => candidate.catalog===target.catalog)) result.candidates.push(target);
    } catch (error) { result.issues.push(`${path}: ${error instanceof Error ? error.message:String(error)}`); }
  }
  if (result.candidates.length===1 && !result.issues.length) { result.status='found';result.library=result.candidates[0]; }
  else if (result.candidates.length>1 || result.issues.length) result.status='ambiguous';
  return result;
}
