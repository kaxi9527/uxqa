import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { runCheck } from '../src/check/run.js';
import { startConsole } from '../src/ui/server.js';
import { addProject, saveRound } from '../src/ui/store.js';

it('keeps wheel, touch and keyboard navigation continuous in a long finding list', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxqa-list-'));
  const prior = process.env.UXQA_HOME;
  process.env.UXQA_HOME = join(root, 'data');
  const project = join(root, 'sample');
  await mkdir(project); await mkdir(process.env.UXQA_HOME);
  await writeFile(join(process.env.UXQA_HOME, 'access-settings.json'), JSON.stringify({ locale: 'zh', onboardingDone: true, checks: [] }));
  await writeFile(join(project, 'styles.css'), Array.from({ length: 795 }, (_, i) => '.item-' + i + ' { color: #' + (0x112233 + i).toString(16) + '; }').join('\n'));
  const entry = await addProject(project, 'Studio');
  const check = await runCheck({ source: project });
  expect(check.violations.filter(item => item.status === 'new')).toHaveLength(795);
  await saveRound(entry.id, check, { partial: '页面返回 404', capture: { baseUrl: 'http://localhost', viewport: 'desktop', pages: [
    { url: 'http://localhost/missing', route: '/missing', status: 'failed', error: '页面返回 404', problems: 0 },
  ], captures: {}, cancelled: false, durationMs: 0 } });
  const server = await startConsole({ port: 0 });
  const browser = await chromium.launch();
  try {
    const url = new URL(server.url);
    url.searchParams.set('project', entry.id); url.searchParams.set('tab', 'issues');
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390 });
      try {
        const page = await context.newPage();
        await page.goto(url.href);
        const rows = page.locator('.issue-row');
        const scroll = page.locator('.list-scroll');
        await rows.first().waitFor();
        expect(await rows.count()).toBe(80);
        const head = page.locator('.list-head');
        const headerBefore = await head.boundingBox();
        await page.getByRole('button', { name: '检查预览地址' }).waitFor();
        expect(await page.locator('.issue-preview-alert').innerText()).toContain('HTTP 404');
        const evidence = process.env.UXQA_GUIDANCE_EVIDENCE;
        if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'finding-list-' + width + '.png') }); }

        const gestureFinished = scroll.evaluate(el => new Promise<void>(resolve => el.addEventListener('scrollend', () => resolve(), { once: true })));
        if (width === 390) {
          const session = await context.newCDPSession(page);
          const box = (await scroll.boundingBox())!;
          const x = box.x + box.width / 2, y = box.y + box.height * 0.8;
          await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let step = 1; step <= 5; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 30 }] });
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await session.detach();
        } else {
          await scroll.hover();
          await page.mouse.wheel(0, 550);
        }
        await gestureFinished;
        expect(await scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(70);
        expect(await head.boundingBox()).toEqual(headerBefore);
        await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
        await page.waitForFunction(() => document.querySelectorAll('.issue-row').length > 80);
        const target = rows.nth(86);
        await target.evaluate(el => el.scrollIntoView({ block: 'center' }));
        const offset = await scroll.evaluate(el => el.scrollTop);
        await target.click();
        await page.locator('#finding-heading').waitFor();
        await page.getByText('预览打不开', { exact: true }).waitFor();
        if (width === 390) await page.getByRole('button', { name: '回到问题列表' }).click();
        expect(Math.abs(await scroll.evaluate(el => el.scrollTop) - offset), 'Scroll position after opening a finding at ' + width + 'px').toBeLessThan(8);
        if (width === 1440) {
          await rows.nth(159).focus();
          await page.keyboard.press('ArrowDown');
          expect(await rows.nth(160).getAttribute('aria-selected')).toBe('true');
          await page.keyboard.press('End');
          expect(await rows.last().getAttribute('aria-posinset')).toBe('795');
          expect(await rows.last().getAttribute('aria-selected')).toBe('true');
        }
        await page.getByRole('searchbox').fill('no matching filename');
        expect(await rows.count()).toBe(0);
        await page.getByRole('button', { name: '清除筛选' }).click();
        await page.getByRole('button', { name: '检查预览地址' }).click();
        await page.waitForFunction(() => document.activeElement?.id === 'base-url');
      } finally { await context.close(); }
    }
  } finally {
    await browser.close(); await server.close();
    if (prior === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = prior;
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
