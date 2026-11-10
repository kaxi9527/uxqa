import { lstat, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileHash } from './paths.js';

const EXCLUDED=new Set(['node_modules','dist','build','artifacts','coverage','vendor']);
const EXTENSIONS=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.css','.scss','.html','.vue','.svelte']);

export async function sourceSnapshot(root: string): Promise<Record<string,string>> {
  const result:Record<string,string>={};
  let bytes=0;
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || EXCLUDED.has(entry.name)) continue;
      const path=join(directory,entry.name);
      if (entry.isDirectory()) {await visit(path);continue;}
      if (!entry.isFile() || !EXTENSIONS.has(extname(entry.name))) continue;
      const stat=await lstat(path);bytes+=stat.size;
      if (stat.size>2_000_000 || bytes>32_000_000 || Object.keys(result).length>=2000) throw new Error('Verification snapshot exceeds limits; use a narrower product package');
      result[relative(root,path)]=await fileHash(path);
    }
  }
  await visit(root);
  return result;
}
