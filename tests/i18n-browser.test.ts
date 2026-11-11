import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { runCheck } from '../src/check/run.js';
import { startConsole } from '../src/ui/server.js';
import { addProject, saveRound } from '../src/ui/store.js';

it('renders product-owned review and settings surfaces in English for an English-only fixture', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-i18n-home-'));
  const project = await mkdtemp(join(tmpdir(), 'uxqa-i18n-product-'));
  const prior = process.env.UXQA_HOME;
  process.env.UXQA_HOME = home;
  await writeFile(join(home, 'access-settings.json'), JSON.stringify({ locale: 'en', onboardingDone: true, checks: [] }));
  await mkdir(join(project, 'src'));
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'english-fixture' }));
  await writeFile(join(project, 'src', 'Screen.tsx'), 'export function Screen() { return <><button style={{color:"#ff0000"}}>Action</button><img src="example.png" /><div className="p-[3px]">Content</div></>; }');
  const entry = await addProject(project, 'English fixture');
  await saveRound(entry.id, await runCheck({ source: project }));
  const server = await startConsole({ port: 0 });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(server.url);
    for (const tab of ['Check', 'Issues', 'Recheck', 'Components', 'Project rules', 'Preview settings']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.waitForLoadState('networkidle');
      if (tab === 'Project rules') await page.getByText('Loading project rules…').waitFor({ state: 'hidden' });
      expect.soft(await page.locator('#workspace').innerText(), `${tab} should not expose untranslated product text`).not.toMatch(/[\u4e00-\u9fff]/);
      if (tab === 'Issues') {
        const findings = page.locator('.issues [role="option"]');
        expect(await findings.count()).toBeGreaterThan(1);
        for (let index = 0; index < await findings.count(); index++) {
          await findings.nth(index).click();
          await page.waitForLoadState('networkidle');
          expect.soft(await page.locator('#workspace').innerText(), `Finding ${index + 1} should be rendered in English`).not.toMatch(/[\u4e00-\u9fff]/);
        }
        await page.getByRole('button', { name: 'Copy for AI', exact: true }).first().click();
        await page.getByRole('heading', { name: 'Repair prompt for AI' }).waitFor();
        expect.soft(await page.locator('.drawer').innerText(), 'Repair prompt should be rendered in English').not.toMatch(/[\u4e00-\u9fff]/);
        await page.keyboard.press('Escape');
      }
      if (tab === 'Project rules') {
        await page.getByText('Advanced: write project rules', { exact: true }).click();
        expect.soft(await page.locator('#workspace').innerText(), 'Advanced rules should be rendered in English').not.toMatch(/[\u4e00-\u9fff]/);
      }
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Access and language' }).waitFor();
    await page.waitForLoadState('networkidle');
    await page.locator('#workspace code').first().waitFor();
    const settingsText = (await page.locator('#workspace').innerText()).replace('\n中文\nEnglish\n', '\nEnglish\n');
    expect.soft(settingsText, 'Settings should not expose untranslated product text').not.toMatch(/[\u4e00-\u9fff]/);
  } finally {
    await context.close(); await browser.close(); await server.close();
    if (prior === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = prior;
    await rm(home, { recursive: true, force: true }); await rm(project, { recursive: true, force: true });
  }
}, 60_000);
