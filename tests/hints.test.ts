import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck, type CheckResult } from '../src/check/run.js';
import { BASIC_RULES, buildRuleSet } from '../src/rules/load.js';

let product: string;
let result: CheckResult;

// Each line is one known mistake; Good.tsx holds the same things written correctly and must stay silent.
const BAD = `export function Bad({ go }: { go: () => void }) {
  return (
    <div>
      <img src="/a.png" />
      <button onClick={go}><svg /></button>
      <div onClick={go}>打开详情</div>
      <a>没有地址</a>
      <a href="#">假链接</a>
      <a href="https://example.com" target="_blank">外部网站</a>
      <span tabIndex={3}>插队</span>
      <input autoFocus aria-label="搜索" />
      <input placeholder="你的邮箱" />
      <form><button>取消</button></form>
      <iframe src="/embed" />
      <button className="outline-none rounded">去掉焦点框</button>
      <span className="transition-all">动画</span>
      <span className="!text-red-500">强行覆盖</span>
      <div className="z-[9999]">最上层</div>
      <div className="w-[1200px]">很宽的盒子</div>
    </div>
  );
}
`;

const GOOD = `export function Good({ go }: { go: () => void }) {
  return (
    <div>
      <img src="/a.png" alt="" width={40} height={40} />
      <button type="button" aria-label="关闭" onClick={go}><svg /></button>
      <div role="button" tabIndex={0} onClick={go} onKeyDown={go}>打开详情</div>
      <a href="/orders">订单</a>
      <a href="https://example.com" target="_blank" rel="noopener noreferrer">外部网站</a>
      <label>邮箱 <input placeholder="you@example.com" /></label>
      <input id="name" />
      <input type="file" className="hidden" />
      <form><button type="submit">提交</button></form>
      <iframe src="/embed" title="付款表单" />
      <button className="outline-none focus-visible:ring-2">有替代焦点样式</button>
      <div className="outline-none">不能获得焦点的容器</div>
      <span className="transition-colors">动画</span>
      <div className="z-50">弹层</div>
      <div className="overflow-x-auto"><table className="min-w-[900px]"><tbody /></table></div>
      <div className="max-w-[1200px]">限制最大宽度</div>
    </div>
  );
}
`;

beforeAll(async () => {
  product = await mkdtemp(join(tmpdir(), 'uxqa-hints-'));
  await mkdir(join(product, 'src'), { recursive: true });
  await writeFile(join(product, 'package.json'), '{"name":"hints","dependencies":{"react":"18"}}');
  await writeFile(join(product, 'src/Bad.tsx'), BAD);
  await writeFile(join(product, 'src/Good.tsx'), GOOD);
  await writeFile(join(product, 'src/bad.css'), '.a:focus { outline: none; }\n.b { transition: all .2s; z-index: 99999; }\n.c { width: 960px; color: red !important; }\n.d { margin: 0 !important; }\n');
  await writeFile(join(product, 'src/good.css'), '.a:focus:not(:focus-visible) { outline: none; }\n.a:focus-visible { outline: 2px solid; }\n.b { transition: opacity .2s; z-index: 10; max-width: 960px; }\n');
  await writeFile(join(product, 'index.html'), '<!doctype html>\n<html>\n<head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"></head>\n<body></body>\n</html>\n');
  result = await runCheck({ source: product });
});

afterAll(async () => { await rm(product, { recursive: true, force: true }); });

const found = (rule: string, file?: string) => result.violations.filter((violation) => violation.rule === rule && (!file || violation.file === file));

describe('common front-end mistakes read from source', () => {
  it('ships every check as a default rule people can re-level or switch off', () => {
    const ids = BASIC_RULES.filter((rule) => rule.type === 'ui-check').map((rule) => rule.id);
    expect(ids).toHaveLength(18);
    const relaxed = buildRuleSet({ rules: [{ id: 'basic/img-alt', level: 'default', reason: '内部工具' }, { id: 'basic/no-autofocus', level: 'off', reason: '搜索页需要' }] });
    expect(relaxed.rules.find((rule) => rule.id === 'basic/img-alt')?.level).toBe('default');
    expect(relaxed.rules.some((rule) => rule.id === 'basic/no-autofocus')).toBe(false);
  });

  it('finds each mistake once, on the right line, with a specific plain name', () => {
    const expectations: Array<[string, number, RegExp]> = [
      ['basic/img-alt', 4, /^图片没写说明文字/],
      ['basic/icon-button-name', 5, /^只有图标的按钮没有名字$/],
      ['basic/clickable-needs-button', 6, /^「打开详情」能点击，却用 <div> 写的$/],
      ['basic/new-window-safety', 9, /^「外部网站」链接在新窗口打开/],
      ['basic/no-positive-tabindex', 10, /第 3 个/],
      ['basic/no-autofocus', 11, /一打开页面就自动获得焦点/],
      ['basic/input-needs-label', 12, /^「你的邮箱」输入框没有标签$/],
      ['basic/button-type-in-form', 13, /^表单里的「取消」按钮没写 type$/],
      ['basic/iframe-title', 14, /iframe/],
      ['basic/keep-focus-outline', 15, /键盘焦点框被去掉了/],
      ['basic/no-transition-all', 16, /all/],
      ['basic/no-important', 17, /!important/],
      ['basic/no-huge-z-index', 18, /9999/],
      ['basic/no-wide-fixed-width', 19, /1200px/],
    ];
    for (const [rule, line, name] of expectations) {
      const hits = found(rule, 'src/Bad.tsx');
      expect(hits.map((hit) => hit.line), rule).toEqual([line]);
      expect(hits[0].name, rule).toMatch(name);
    }
    expect(found('basic/link-needs-href', 'src/Bad.tsx').map((hit) => hit.line)).toEqual([7, 8]);
  });

  it('stays silent on the same things written correctly', () => {
    const quiet = result.violations.filter((violation) => violation.file === 'src/Good.tsx' || violation.file === 'src/good.css');
    expect(quiet.filter((violation) => violation.rule !== 'basic/no-arbitrary-size').map((violation) => `${violation.rule}@${violation.line}`)).toEqual([]);
  });

  it('reports a wide fixed width once, not also as a generic hard-coded size', () => {
    expect(result.violations.filter((violation) => violation.file === 'src/Bad.tsx' && violation.line === 19).map((violation) => violation.rule)).toEqual(['basic/no-wide-fixed-width']);
  });

  it('reads stylesheets and index.html too', () => {
    expect(found('basic/keep-focus-outline', 'src/bad.css').map((hit) => hit.line)).toEqual([1]);
    expect(found('basic/no-transition-all', 'src/bad.css')).toHaveLength(1);
    expect(found('basic/no-huge-z-index', 'src/bad.css')[0].name).toContain('99999');
    expect(found('basic/no-wide-fixed-width', 'src/bad.css')[0].name).toContain('960px');
    const important = found('basic/no-important', 'src/bad.css');
    expect(important).toHaveLength(1);
    expect(important[0].name).toContain('共 2 处');
    expect(found('basic/allow-zoom', 'index.html').map((hit) => hit.line)).toEqual([3]);
    expect(found('basic/page-language', 'index.html').map((hit) => hit.line)).toEqual([2]);
  });
});
