import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listProductFiles } from '../check/scan.js';

/**
 * Page paths declared in the product's router, read from source: React Router `<Route path="/x">`,
 * route objects `{ path: "/x" }` (React Router, vue-router), Next.js-style `app/x/page.tsx` / `pages/x.tsx` files,
 * Nuxt `pages/x.vue` and SvelteKit `src/routes/x/+page.svelte`.
 * Only plain paths are returned; parameters (`:id`, `[id]`) and wildcards are skipped because they need real data.
 */
export async function routesFromSource(productRoot: string, limit = 24): Promise<string[]> {
  const routes = new Set<string>();
  const add = (path: string) => {
    const clean = path.replace(/\/+$/, '') || '/';
    if (!clean.startsWith('/') || /[:*[\]()]/.test(clean)) return;
    routes.add(clean);
  };
  // `pages/x.tsx` only means a route in Next.js; plenty of Vite apps keep ordinary components in src/pages.
  const manifest = await readFile(join(productRoot, 'package.json'), 'utf8').catch(() => '');
  const fileRoutes = /"next"\s*:/.test(manifest);
  const nuxt = /"nuxt"\s*:/.test(manifest);
  const svelteKit = /"@sveltejs\/kit"\s*:/.test(manifest);
  // Route groups `(name)` do not appear in the address; `index` is the folder itself.
  const fromSegments = (path: string) => `/${path.split('/').filter((segment) => segment && !/^\(.*\)$/.test(segment) && segment !== 'index').join('/')}`;
  for (const file of await listProductFiles(productRoot)) {
    if (routes.size >= limit) break;
    const relative = file.slice(productRoot.length + 1);
    const next = relative.match(/^(?:src\/)?app\/(.*?)\/?page\.(tsx|jsx|ts|js)$/) ?? relative.match(/^(?:src\/)?pages\/(.*?)\.(tsx|jsx)$/);
    if (next && fileRoutes) {
      const segments = next[1].split('/').filter((segment) => segment && !/^\(.*\)$/.test(segment) && segment !== 'index' && !segment.startsWith('_') && segment !== 'api');
      if (!next[1].includes('api/') && !/^_/.test(next[1])) add(`/${segments.join('/')}`);
      continue;
    }
    const nuxtPage = nuxt ? relative.match(/^(?:src\/|app\/)?pages\/(.*?)\.vue$/) : null;
    if (nuxtPage) { add(fromSegments(nuxtPage[1])); continue; }
    const kitPage = svelteKit ? relative.match(/^src\/routes\/(?:(.*)\/)?\+page\.svelte$/) : null;
    if (kitPage) { add(fromSegments(kitPage[1] ?? '')); continue; }
    if (!/\.(tsx|jsx|ts|js)$/.test(file)) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text.includes('path')) continue;
    for (const match of text.matchAll(/<Route\b[^>]*?\bpath=["'`]([^"'`]+)["'`]/g)) add(match[1]);
    if (/createBrowserRouter|createHashRouter|useRoutes|RouteObject|createRouter|RouteRecordRaw|vue-router/.test(text)) {
      for (const match of text.matchAll(/\bpath\s*:\s*["'`](\/[^"'`]*)["'`]/g)) add(match[1]);
    }
  }
  return [...routes].slice(0, limit);
}
