import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { analyzePageCss } from '../src/components/css.js';

describe('browser stylesheet scope', () => {
  it('marks cross-origin CSSOM gaps instead of claiming complete CSS coverage', async () => {
    const styles = createServer((_request,response) => { response.setHeader('content-type','text/css');response.end('.card{padding:20px}'); });
    await new Promise<void>((resolve) => styles.listen(0,'127.0.0.1',resolve));
    const cssUrl = `http://127.0.0.1:${(styles.address() as {port:number}).port}/remote.css`;
    const site = createServer((_request,response) => {response.setHeader('content-type','text/html');response.end(`<html><head><style>:root{--brand:red}.card{color:var(--brand)}</style><link rel="stylesheet" href="${cssUrl}"></head><body><article class="card">Record</article></body></html>`);});
    await new Promise<void>((resolve) => site.listen(0,'127.0.0.1',resolve));
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${(site.address() as {port:number}).port}`);
        const result = await analyzePageCss(page);
        expect(result.status).toBe('partial');
        expect(result.gaps.some((gap) => /inaccessible/.test(gap))).toBe(true);
        expect(result.analyses[0].summary.usedTokens).toBe(1);
      } finally { await context.close(); }
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => site.close(() => resolve()));
      await new Promise<void>((resolve) => styles.close(() => resolve()));
    }
  },20_000);
});
