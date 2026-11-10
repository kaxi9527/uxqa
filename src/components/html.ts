import { relative, sep } from 'node:path';

export function escape(value: unknown): string {
  return String(value).replace(/[&<>"']/g,(character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
}
export function artifactLink(path: string, root: string): string {
  return relative(root,path).split(sep).map(encodeURIComponent).join('/');
}
