import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routesFromSource } from '../src/capture/routes.js';
import { buildRuleSet, RuleConfigError } from '../src/rules/load.js';
import { auditVisual, type VisualResult } from '../src/visual/audit.js';

// One page with a known problem of each kind, plus things that must NOT be reported.
const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>visual</title>
<style>body{margin:0;font:14px/1.4 sans-serif} .cta-row{display:flex;gap:8px;width:40%} .cta-main{font-size:16px;padding:8px 12px}
.toolbar{display:flex;gap:8px;align-items:flex-start;margin:16px 0} .tb-btn{height:40px} .tb-input{height:30px}
.fine-print{font-size:10px} .mini-link{font-size:12px;line-height:14px} .wrap-ok{width:80px}</style></head>
<body><main>
  <div class="cta-row"><button class="cta-main">立即报名参加活动</button></div>
  <div class="wrap-ok"><button data-button-wrap="allow" class="allow-btn">允许换行的长按钮文字</button></div>
  <div class="toolbar"><button class="tb-btn">筛选条件</button><input class="tb-input" placeholder="搜索"></div>
  <div class="notes"><span class="fine-print">备注一</span> <span class="fine-print">备注二</span> <span class="fine-print">备注三</span></div>
  <div class="links"><a href="#" class="mini-link">统计</a></div>
  <div class="snug" style="width:96px"><button class="fit-btn" style="font-size:14px">确认订单</button></div>
</main></body></html>`;

// A second page for the newer checks: contrast, spilled text, stretched images, tight lines and page-wide consistency.
const STRETCHED = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='200' height='100'><rect width='200' height='100' fill='teal'/></svg>");
const MORE = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>more</title>
<style>body{margin:0;font:14px/1.5 sans-serif} .stack > div{margin:6px 0}</style></head><body><main>
  <p class="faint-note" style="color:#bbb">浅灰色的说明文字</p>
  <button disabled style="color:#ccc">禁用的按钮</button>
  <div class="tag-box" style="width:60px;white-space:nowrap">这是一段很长不会换行的文字</div>
  <div style="width:120px;overflow-x:auto"><pre style="margin:0">code line that is very long and scrolls sideways</pre></div>
  <img alt="横幅" src="${STRETCHED}" style="width:100px;height:100px">
  <p class="dense" style="font-size:14px;line-height:15px;width:200px">这是一段比较长的正文，用来检查行距是不是太挤，读起来会不会很累，所以要写够两行以上。</p>
  <div>${[11, 12, 13, 14, 15, 16, 17, 18, 20, 22].map((size) => `<span style="font-size:${size}px">字${size}</span>`).join(' ')}</div>
  <div class="stack">${[[24, 0], [28, 4], [32, 8], [40, 12], [48, 4]].map(([h, r]) => `<div><button style="height:${h}px;border-radius:${r}px;padding:0 12px">按钮${h}</button></div>`).join('')}</div>
</main></body></html>`;

// Things that only show up after a click, plus things that must never be clicked or must not do anything.
const MENUS = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>menus</title>
<style>body{margin:0;font:14px/1.5 sans-serif} .menu{position:absolute;top:40px;left:8px;background:#fff;border:1px solid #ddd;padding:4px} .menu-item{width:72px;font-size:14px}</style></head><body><main>
  <button id="more" aria-haspopup="menu" aria-expanded="false">更多操作</button>
  <div class="menu" id="menu" hidden><button class="menu-item">导出全部数据为表格</button></div>
  <div role="tablist"><button role="tab" aria-selected="true">概览</button><button role="tab" aria-selected="false" id="t2">明细</button></div>
  <div id="p2" hidden><span class="fine" style="font-size:9px">很小的说明文字</span></div>
  <button aria-haspopup="dialog" aria-expanded="false">帮助中心</button>
  <button id="del" aria-haspopup="dialog" aria-expanded="false">删除项目</button>
  <button id="away" aria-expanded="false">去别的页面</button>
</main>
<script>
  document.getElementById('more').onclick = (e) => { fetch('/api/track', { method: 'POST', body: 'x' }).catch(() => {}); document.getElementById('menu').hidden = false; e.currentTarget.setAttribute('aria-expanded', 'true'); };
  document.getElementById('t2').onclick = (e) => { document.getElementById('p2').hidden = false; e.currentTarget.setAttribute('aria-selected', 'true'); };
  document.getElementById('del').onclick = () => { fetch('/api/delete', { method: 'POST' }).catch(() => {}); };
  document.getElementById('away').onclick = () => { location.href = '/elsewhere'; };
</script></body></html>`;
let writes = 0;
let menus: VisualResult;

let product: string;
let out: string;
let site: Server;
let baseUrl: string;
let main: VisualResult;
let showcase: VisualResult;
let more: VisualResult;

beforeAll(async () => {
  product = await mkdtemp(join(tmpdir(), 'uxqa-visual-product-'));
  out = await mkdtemp(join(tmpdir(), 'uxqa-visual-out-'));
  await mkdir(join(product, 'src/pages'), { recursive: true });
  await writeFile(join(product, 'package.json'), '{"name":"visual-fixture","dependencies":{"react":"18"}}');
  // The link text lives in two files; only Home.tsx carries the class the page element has.
  await writeFile(join(product, 'src/pages/Home.tsx'), 'export function Home() {\n  return (\n    <div className="links">\n      <a href="#" className="mini-link">统计</a>\n    </div>\n  );\n}\n');
  await writeFile(join(product, 'src/pages/Menu.tsx'), 'export function Menu() {\n  return <MenuItem className="menu-entry">统计</MenuItem>;\n}\n');
  // The wrapping button is written identically in two files: there is no way to tell which one, so no line may be claimed.
  await writeFile(join(product, 'src/pages/SignupA.tsx'), 'export const A = () => <div className="cta-row"><button className="cta-main">立即报名参加活动</button></div>;\n');
  await writeFile(join(product, 'src/pages/SignupB.tsx'), 'export const B = () => <div className="cta-row"><button className="cta-main">立即报名参加活动</button></div>;\n');
  site = createServer((request, response) => {
    if (request.method !== 'GET') { writes++; response.writeHead(204); response.end(); return; }
    if (request.url !== '/' && request.url !== '/design-system' && request.url !== '/more' && request.url !== '/menus') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(request.url === '/more' ? MORE : request.url === '/menus' ? MENUS : PAGE);
  });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  main = await auditVisual({ baseUrl, routes: ['/'], productRoot: product }, join(out, 'main'));
  menus = await auditVisual({ baseUrl, routes: ['/menus'], productRoot: product }, join(out, 'menus'));
  more = await auditVisual({ baseUrl, routes: ['/more'], productRoot: product }, join(out, 'more'));
  showcase = await auditVisual({ baseUrl, routes: ['/design-system'], productRoot: product }, join(out, 'showcase'), { disabled: new Set(['visual/min-font-size']), firstNumber: 100 });
}, 240_000);

afterAll(async () => {
  await new Promise<void>((done) => site.close(() => done()));
  await rm(product, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

const byRule = (result: VisualResult, rule: string) => result.violations.filter((violation) => violation.rule === rule);

describe('page visual checks', () => {
  it('finds a button whose text wraps when the window narrows, and leaves opted-out buttons alone', () => {
    const wrap = byRule(main, 'visual/no-wrap');
    expect(wrap.map((violation) => violation.name)).toEqual([expect.stringMatching(/^「立即报名参加活动」按钮在 [\d、]+ 宽(及更窄)?时折成了两行$/)]);
    expect(main.violations.some((violation) => violation.name.includes('允许换行'))).toBe(false);
  });

  it('never guesses a code line when the same text is written in more than one place', () => {
    const [wrap] = byRule(main, 'visual/no-wrap');
    expect(wrap.file).toBe('页面 /');
    expect(wrap.line).toBe(0);
  });

  it('picks the file whose class names match the element, not just the first file with the same words', () => {
    const [link] = byRule(main, 'visual/min-tap-area');
    expect(link.name).toMatch(/^「统计」链接点击区只有 \d+×\d+$/);
    expect(link.file).toBe('src/pages/Home.tsx');
    expect(link.line).toBe(4);
  });

  it('reports controls of different heights in one row', () => {
    const [row] = byRule(main, 'visual/same-row-same-size');
    expect(row.name).toContain('高矮不一');
    expect(row.line).toBe(0);
  });

  it('groups same-styled small text into one problem with a count', () => {
    const tiny = byRule(main, 'visual/min-font-size');
    expect(tiny).toHaveLength(1);
    expect(tiny[0].name).toBe('「备注一」等 3 处字号只有 10px');
  });

  it('marks every problem on a screenshot', async () => {
    expect(main.checkedPages).toBe(1);
    for (const violation of main.violations) {
      const capture = main.captures[violation.fingerprint];
      expect(capture?.status, violation.name).toBe('found');
      expect((await stat(capture.shots[0].crop)).size).toBeGreaterThan(1000);
    }
  });

  it('skips row-consistency checks on component showcase pages and honours switched-off rules', () => {
    expect(showcase.checkedPages).toBe(1);
    expect(byRule(showcase, 'visual/same-row-same-size')).toHaveLength(0);
    expect(byRule(showcase, 'visual/min-font-size')).toHaveLength(0);
    // The page was still checked for everything else.
    expect(byRule(showcase, 'visual/min-tap-area')).toHaveLength(1);
    expect(Math.min(...Object.values(showcase.captures).map((capture) => capture.number ?? 0))).toBe(100);
  });
});

describe('click-revealed UI', () => {
  const names = () => menus.violations.map((violation) => violation.name);

  it('opens menus and tabs and reports problems that only exist while they are open', () => {
    expect(names()).toContainEqual(expect.stringMatching(/^点开「更多操作」菜单后：「导出全部数据为表格」按钮在 .+折成了两行$/));
    expect(names()).toContain('点开「明细」标签页后：「很小的说明文字」字号只有 9px');
    const opened = menus.violations.find((violation) => violation.name.startsWith('点开「更多操作」'))!;
    expect(opened.detail).toContain('状态：点开「更多操作」菜单后');
    expect(menus.captures[opened.fingerprint].status).toBe('found');
    expect(menus.views.some((view) => view.route === '/menus · 点开「更多操作」菜单后')).toBe(true);
  });

  it('reports a control that promises to open something but does nothing', () => {
    expect(names()).toContain('「帮助中心」弹窗点了没有反应');
    expect(byRule(menus, 'visual/opener-works')).toHaveLength(1);
  });

  it('stays read-only: never clicks risky controls, blocks write requests, ignores controls that navigate away', () => {
    expect(writes).toBe(0);
    expect(names().some((name) => name.includes('删除项目') || name.includes('去别的页面'))).toBe(false);
  });
});

describe('long-text stress', () => {
  it('reports controls that only break once their text is about 60% longer, and not the ones already broken', () => {
    const names = byRule(main, 'visual/long-text-safe').map((violation) => violation.name);
    expect(names).toContain('「确认订单」按钮在文字变长时折成了两行');
    expect(names.some((name) => name.includes('立即报名参加活动'))).toBe(false);
    expect(byRule(main, 'visual/long-text-safe')[0].level).toBe('reference');
  });
});

describe('newer page checks', () => {
  const names = (rule: string) => byRule(more, rule).map((violation) => violation.name);

  it('flags text too faint to read, but not disabled controls', () => {
    expect(names('visual/min-contrast')).toEqual([expect.stringMatching(/^「浅灰色的说明文字」颜色太淡，看不清$/)]);
    expect(byRule(more, 'visual/min-contrast')[0].what).toMatch(/对比度只有 [\d.]+，至少要 4\.5/);
  });

  it('flags text running out of its box, but not content in a box that scrolls sideways', () => {
    expect(names('visual/no-text-overflow')).toEqual([expect.stringMatching(/^「这是一段很长不会换行的文字」在 .+跑出了框$/)]);
  });

  it('flags a squashed image and lines set too tight', () => {
    expect(names('visual/image-not-stretched')).toEqual(['图片「横幅」被拉变形了']);
    expect(byRule(more, 'visual/image-not-stretched')[0].what).toContain('200×100');
    expect(names('visual/comfortable-line-height')).toEqual([expect.stringMatching(/行距太挤$/)]);
  });

  it('flags a page that mixes too many font sizes, button heights and corner radii', () => {
    expect(names('visual/few-font-sizes')[0]).toMatch(/^这一页用了 1\d 种字号$/);
    expect(names('visual/consistent-button-height')).toEqual(['这一页的按钮有 6 种高度']); // five styled buttons plus the browser-default disabled one
    expect(names('visual/consistent-radius')).toEqual(['这一页的按钮有 4 种圆角']);
  });
});

describe('page rule overrides', () => {
  it('accepts visual/* levels, needs a reason to switch one off, and rejects unknown names', () => {
    const rules = buildRuleSet({ rules: [{ id: 'visual/min-tap-area', level: 'must' }, { id: 'visual/no-title-orphan', level: 'off', reason: '标题由运营配置' }] });
    expect(rules.visual).toEqual([{ id: 'visual/min-tap-area', level: 'must' }, { id: 'visual/no-title-orphan', level: 'off', reason: '标题由运营配置' }]);
    expect(rules.disabled).toContainEqual({ id: 'visual/no-title-orphan', reason: '标题由运营配置' });
    expect(() => buildRuleSet({ rules: [{ id: 'visual/no-wrap', level: 'off' }] })).toThrow(RuleConfigError);
    expect(() => buildRuleSet({ rules: [{ id: 'visual/no-such-check', level: 'must' }] })).toThrow(/没有名为 visual\/no-such-check/);
  });
});

describe('routes read from source', () => {
  it('reads router paths, skips parameters, and only treats pages/ as routes in Next.js projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uxqa-routes-'));
    try {
      await mkdir(join(root, 'src/pages'), { recursive: true });
      await writeFile(join(root, 'package.json'), '{"dependencies":{"react-router-dom":"6"}}');
      await writeFile(join(root, 'src/App.tsx'), '<Routes><Route path="/" element={<Home/>} /><Route path="/orders" element={<Orders/>} /><Route path="/orders/:id" element={<Order/>} /></Routes>');
      await writeFile(join(root, 'src/pages/Orders.tsx'), 'export const Orders = () => null;');
      expect(await routesFromSource(root)).toEqual(['/', '/orders']);

      await writeFile(join(root, 'package.json'), '{"dependencies":{"next":"15"}}');
      await rm(join(root, 'src/App.tsx'));
      await mkdir(join(root, 'app/settings'), { recursive: true });
      await mkdir(join(root, 'app/(shop)/cart'), { recursive: true });
      await mkdir(join(root, 'app/posts/[slug]'), { recursive: true });
      for (const page of ['app/page.tsx', 'app/settings/page.tsx', 'app/(shop)/cart/page.tsx', 'app/posts/[slug]/page.tsx']) await writeFile(join(root, page), 'export default function Page() { return null; }');
      expect((await routesFromSource(root)).sort()).toEqual(['/', '/Orders', '/cart', '/settings']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
