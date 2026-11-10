import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { inside } from '../components/source.js';

export function hash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
export async function fileHash(path: string): Promise<string> { return hash(await readFile(path)); }

export async function boundPath(root: string, path: string, kind: 'file'|'directory' = 'file'): Promise<string> {
  const absolute = resolve(root,path);
  const resolved = await realpath(absolute);
  if (!inside(root,resolved)) throw new Error(`Path escapes product/library boundary: ${path}`);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Symlink is not permitted for synchronized inputs: ${path}`);
  if (kind==='file' ? !stat.isFile():!stat.isDirectory()) throw new Error(`Expected ${kind}: ${path}`);
  return resolved;
}
export function productRelativePath(path: unknown, label: string): string {
  if (typeof path!=='string' || !path || isAbsolute(path) || relative('.',path).startsWith('..') || path.includes('\\')) {
    throw new Error(`${label} must be a relative path inside the product`);
  }
  return path;
}
