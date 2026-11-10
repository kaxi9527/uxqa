import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const report = resolve(process.argv[2]);
const browser = await chromium.launch();
try {
  for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
    const context = await browser.newContext({viewport:{width,height}});
    try {
      const page = await context.newPage();
      await page.goto(pathToFileURL(report).href);
      const state = await page.evaluate(() => ({
        title:document.title,heading:document.querySelector('h1')?.textContent,
        width:document.documentElement.scrollWidth,viewport:window.innerWidth,
        images:[...document.images].map((image) => ({width:image.naturalWidth,height:image.naturalHeight,renderedWidth:image.clientWidth,renderedHeight:image.clientHeight,complete:image.complete})),
      }));
      assert.equal(state.title,'Component audit');
      assert.ok(state.heading);
      assert.ok(state.width<=state.viewport,'Report overflows horizontally');
      assert.ok(state.images.length>0,'No screenshot evidence in report');
      assert.ok(state.images.every((image) => image.complete && image.width>0),'Broken screenshot evidence');
      assert.ok(state.images.every((image) => image.renderedWidth<=image.width && image.renderedHeight<=image.height),'Evidence screenshots are upscaled and blurred');
      await page.screenshot({path:resolve(dirname(report),`report-${name}.png`)});
      await page.locator('.instances a').first().click();
      assert.ok(page.url().endsWith('.png'),'Evidence link does not open a screenshot');
      console.log(`${name}: report renders, ${state.images.length} evidence images, no horizontal overflow`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
