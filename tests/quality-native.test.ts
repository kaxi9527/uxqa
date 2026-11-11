import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { inspectQuality } from '../src/visual/quality.js';
import { auditVisual } from '../src/visual/audit.js';
import { issueGuidance } from '../src/guidance/issues.js';

const BAD = `<!doctype html><html lang="zh"><title>Quality fixture</title><style>
body{font:16px/1.5 sans-serif;padding:24px}button,input{min-height:32px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.cards article{border:1px solid #ccc;padding:12px}
.all{transition:all .3s}.moving{width:40px;height:40px;background:#111;animation:move 10s infinite linear}.layout{position:relative;animation:layout 10s infinite}
@keyframes move{to{transform:translateX(20px)}}@keyframes layout{to{left:10px}}
</style><body><main><h1>项目</h1><h3>跳跃标题</h3><button><svg width="20" height="20" aria-hidden="true"></svg></button><input placeholder="仅占位符"><button class="all">保存</button><div class="moving"></div><div class="layout">布局动画</div><div class="cards">${Array.from({ length: 12 }, (_, n) => `<article><h2>项目 ${n}</h2><button>打开项目 ${n}</button></article>`).join('')}</div></main></body></html>`;
const GOOD = `<!doctype html><html lang="zh"><title>Good fixture</title><style>
body{font:16px/1.5 sans-serif}button,input{min-height:32px}.moving{width:40px;height:40px;animation:move 10s infinite}@keyframes move{to{transform:translateX(20px)}}@media(prefers-reduced-motion:reduce){.moving{animation:none}}
</style><body><main><h1>项目</h1><h2>设置</h2><button aria-label="关闭"><svg width="20" height="20" aria-hidden="true"></svg></button><label>名称<input placeholder="名称"></label><div class="moving"></div></main></body></html>`;

it('observes actual structure and motion and respects accessible names and reduced-motion CSS', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  try {
    const page = await context.newPage();
    await page.setContent(BAD);
    expect(new Set((await inspectQuality(page, true)).map((issue) => issue.kind))).toEqual(new Set(['card-density', 'unnamed-control', 'unlabelled-field', 'heading-order', 'transition-all', 'layout-animation', 'reduced-motion']));
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
    await page.setContent(GOOD);
    await page.locator('main').evaluate((element) => element.insertAdjacentHTML('beforeend', '<svg width="100" height="40"><a href="#settings"><text x="0" y="20">设置</text></a></svg>'));
    expect(await inspectQuality(page, true)).toEqual([]);
  } finally { await context.close(); await browser.close(); }
});

it('integrates findings into screenshot reports, categories and rule controls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uxqa-quality-audit-'));
  const source = join(directory, 'product');
  await mkdir(source);
  const site = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(BAD); });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  try {
    const result = await auditVisual({ baseUrl: `http://127.0.0.1:${(site.address() as { port: number }).port}`, routes: ['/'], productRoot: source }, join(directory, 'shots'), {
      disabled: new Set(['visual/heading-order', 'visual/long-text-safe', 'visual/opener-works']), levels: new Map([['visual/control-name', 'default']]),
    });
    const ui = result.violations.find((issue) => issue.rule === 'visual/card-density')!;
    const ux = result.violations.find((issue) => issue.rule === 'visual/control-name')!;
    const experience = result.violations.find((issue) => issue.rule === 'visual/reduced-motion')!;
    expect(issueGuidance(ui).domain).toBe('ui');
    expect(issueGuidance(ux).domain).toBe('ux');
    expect(issueGuidance(experience).domain).toBe('experience');
    expect(ux.level).toBe('default');
    expect(result.violations.some((issue) => issue.rule === 'visual/heading-order')).toBe(false);
    expect(result.captures[experience.fingerprint].shots.length).toBeGreaterThan(0);
    expect(experience.what).toContain('减少动态效果已启用');
  } finally { await new Promise<void>((done) => site.close(() => done())); await rm(directory, { recursive: true, force: true }); }
}, 60_000);
