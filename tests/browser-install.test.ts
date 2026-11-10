import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBytes, isInstalled, parseDryRun } from '../src/browser/install.js';

const DRY_RUN = `Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248)
  Install location:    /cache/ms-playwright/chromium_headless_shell-1248
  Download url:        https://cdn.playwright.dev/builds/cft/156.0.8078.4/mac-arm64/chrome-headless-shell-mac-arm64.zip

FFmpeg (playwright ffmpeg v1013)
  Install location:    /cache/ms-playwright/ffmpeg-1013
  Download url:        https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1013/ffmpeg-mac-arm64.zip
  Download fallback 1: https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/ffmpeg/1013/ffmpeg-mac-arm64.zip
`;

describe('browser component', () => {
  it('reads what Playwright would download, one entry per browser, primary url only', () => {
    const entries = parseDryRun(DRY_RUN);
    expect(entries).toEqual([
      { title: 'Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248)', location: '/cache/ms-playwright/chromium_headless_shell-1248', url: 'https://cdn.playwright.dev/builds/cft/156.0.8078.4/mac-arm64/chrome-headless-shell-mac-arm64.zip' },
      { title: 'FFmpeg (playwright ffmpeg v1013)', location: '/cache/ms-playwright/ffmpeg-1013', url: 'https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1013/ffmpeg-mac-arm64.zip' },
    ]);
    expect(parseDryRun('ERROR: something went wrong')).toEqual([]);
  });

  it('counts a browser as installed only when Playwright finished unpacking it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uxqa-browser-'));
    const location = join(dir, 'chromium_headless_shell-1248');
    expect(isInstalled(location)).toBe(false);
    await mkdir(location);
    expect(isInstalled(location)).toBe(false);
    await writeFile(join(location, 'INSTALLATION_COMPLETE'), '');
    expect(isInstalled(location)).toBe(true);
  });

  it('states sizes in MiB and says so when unknown', () => {
    expect(formatBytes(103778487)).toBe('99.0 MiB');
    expect(formatBytes(undefined)).toBe('大小未知');
  });
});
