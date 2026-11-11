import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { startConsole } from '../src/ui/server.js';

it('guides a first user, checks a selected folder and warns if it later disappears', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-access-browser-home-'));
  const project = await mkdtemp(join(tmpdir(), 'uxqa-access-browser-project-'));
  const moved = `${project}-moved`, previous = process.env.UXQA_HOME;
  await writeFile(join(project, 'private-name.txt'), 'not part of any response');
  process.env.UXQA_HOME = home;
  const server = await startConsole({ port: 0 });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors: string[] = [];
  await page.addInitScript(() => {
    const target = window as unknown as { languageUpdates: Array<string | null>; webkit: unknown };
    target.languageUpdates = [];
    target.webkit = { messageHandlers: { uxqaLanguage: { postMessage: (locale: string | null) => target.languageUpdates.push(locale) } } };
  });
  const discoveryRequests: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/discover') discoveryRequests.push(request.url()); });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(server.url);
    await page.getByRole('heading', { name: '选择语言 / Choose your language' }).waitFor();
    await page.keyboard.press('Escape');
    expect(await page.getByRole('heading', { name: '选择语言 / Choose your language' }).isVisible()).toBe(true);
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('heading', { name: 'Understand access' }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { languageUpdates: Array<string | null> }).languageUpdates)).toContain('en');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByLabel('Folder path').fill(project);
    await page.getByRole('button', { name: 'Check and authorize if needed' }).click();
    await page.getByRole('status').filter({ hasText: 'Accessible at last check' }).waitFor();
    expect(await page.getByRole('dialog').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('heading', { name: 'Local network and optional connections' }).waitFor();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByTitle('Settings (all projects)').waitFor();
    await page.getByRole('heading', { name: 'From finding issues to verifying fixes' }).waitFor();
    expect(discoveryRequests).toEqual([]);
    await page.getByTitle('Add project').click();
    expect(discoveryRequests).toEqual([]);
    await page.route('**/api/discover', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'denied' }) }), { times: 1 });
    await page.getByRole('button', { name: 'Scan ~/Projects' }).click();
    await page.getByRole('alert').filter({ hasText: 'Could not scan this location' }).waitFor();
    expect(discoveryRequests).toHaveLength(1);
    await page.keyboard.press('Escape');
    await rename(project, moved);
    await page.reload();
    await page.getByRole('button', { name: 'A project location is unavailable. Open Settings.' }).click();
    await page.getByRole('heading', { name: 'Access and language' }).waitFor();
    await page.getByText(/Location missing or moved/).waitFor();
    await page.getByLabel('Interface language').selectOption('zh');
    await page.getByRole('heading', { name: '访问与语言' }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { languageUpdates: Array<string | null> }).languageUpdates.at(-1))).toBe('zh');
    expect(errors).toEqual([]);
  } finally {
    await context.close(); await browser.close(); await server.close();
    if (previous === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previous;
    await rm(home, { recursive: true, force: true }); await rm(project, { recursive: true, force: true }); await rm(moved, { recursive: true, force: true });
  }
}, 60_000);
