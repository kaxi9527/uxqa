import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeBaseline } from '../src/check/baseline.js';
import { formatPrompt, formatText } from '../src/check/format.js';
import { runCheck } from '../src/check/run.js';
import { findComponents } from '../src/inventory/find.js';
import { componentByName, readInventory } from '../src/inventory/read.js';
import { BASIC_RULES, buildRuleSet, RuleConfigError, validateAgainstInventory } from '../src/rules/load.js';

const exec = promisify(execFile);
const cli = resolve('src/cli.ts');
const FIXTURE = resolve('examples/check-fixture');
let product: string;

beforeAll(async () => {
  product = await mkdtemp(join(tmpdir(), 'uxqa-check-'));
  await cp(FIXTURE, product, { recursive: true });
});
afterAll(async () => { await rm(product, { recursive: true, force: true }); });

describe('component library inventory', () => {
  it('finds a shadcn library through components.json and tsconfig paths, with variants, defaults and rendered element', async () => {
    const inventory = await readInventory(product);
    expect(inventory).toMatchObject({ source: 'shadcn', library: 'src/components/ui', importBase: '@/components/ui' });
    const button = componentByName(inventory, 'Button')!;
    expect(button).toMatchObject({
      file: 'src/components/ui/button.tsx', importPath: '@/components/ui/button', label: '按钮', renders: 'button',
      variants: { variant: ['default', 'outline', 'ghost'], size: ['default', 'sm'] }, defaults: { variant: 'default', size: 'default' },
    });
    // The compatibility copy in legacy.tsx is not the preferred Button.
    expect(inventory.components.filter((component) => component.name === 'Button')).toHaveLength(2);
    expect(inventory.tokens.find((token) => token.name === 'primary')).toMatchObject({ value: '#1a73e8', kind: 'color' });
  });

  it('answers plain-language lookups and admits when nothing exists', async () => {
    const inventory = await readInventory(product);
    expect(findComponents(inventory, '标签页')[0].component.name).toBe('Tabs');
    expect(findComponents(inventory, '按钮').map((match) => match.component.file)).toEqual(['src/components/ui/button.tsx']);
    expect(findComponents(inventory, '日历')).toEqual([]);
  });
});

describe('rule sets', () => {
  it('layers project rules on the basic pack instead of replacing it', () => {
    const rules = buildRuleSet({ rules: [{ id: 'no-antd', type: 'forbid-import', module: 'antd', level: 'must' }, { id: 'tone', text: '整体要简洁' }] });
    expect(rules.rules.map((rule) => rule.id)).toEqual([...BASIC_RULES.map((rule) => rule.id), 'no-antd']);
    expect(rules.rules.slice(0, 5).map((rule) => rule.id)).toEqual(['basic/use-library-component', 'basic/no-duplicate-component', 'basic/no-hardcoded-color', 'basic/no-arbitrary-size', 'basic/repeated-pattern']);
    expect(rules.guidance).toEqual([{ id: 'tone', text: '整体要简洁', level: 'default' }]);
    expect(buildRuleSet({ extends: null, rules: [] }).rules).toEqual([]);
  });

  it('requires reasons to switch off or loosen a basic rule, and supports switching off only in a scope', () => {
    expect(() => buildRuleSet({ rules: [{ id: 'basic/no-hardcoded-color', level: 'off' }] })).toThrow(/reason/);
    expect(() => buildRuleSet({ rules: [{ id: 'basic/no-hardcoded-color', level: 'reference' }] })).toThrow(/reason/);
    const scoped = buildRuleSet({ rules: [{ id: 'basic/no-arbitrary-size', level: 'off', scope: ['src/admin/**'], reason: '表格列宽逐列定' }] });
    expect(scoped.rules.find((rule) => rule.id === 'basic/no-arbitrary-size')).toMatchObject({ level: 'default', exclude: ['src/admin/**'] });
    expect(scoped.disabled[0].reason).toBe('表格列宽逐列定');
    const removed = buildRuleSet({ rules: [{ id: 'basic/no-arbitrary-size', level: 'off', reason: '不需要' }] });
    expect(removed.rules.some((rule) => rule.id === 'basic/no-arbitrary-size')).toBe(false);
  });

  it('rejects unknown types, invented basic ids and missing parameters in plain language', () => {
    expect(() => buildRuleSet({ rules: [{ id: 'x', type: 'make-it-pretty' }] })).toThrow(RuleConfigError);
    expect(() => buildRuleSet({ rules: [{ id: 'basic/mine', type: 'forbid-import', module: 'x' }] })).toThrow(/basic\//);
    expect(() => buildRuleSet({ rules: [{ id: 'x', type: 'require-prop', component: 'Image' }] })).toThrow(/prop/);
    expect(() => buildRuleSet({ rules: [{ id: 'x' }] })).toThrow(/text/);
  });

  it('treats a component name that does not exist in the library as a configuration error', async () => {
    const inventory = await readInventory(product);
    const rules = buildRuleSet({ rules: [{ id: 'img-alt', type: 'require-prop', component: 'Imagex', prop: 'alt' }] });
    expect(validateAgainstInventory(rules, inventory)[0]).toMatch(/Imagex/);
  });
});

describe('uxqa check', () => {
  it('reports library bypasses, duplicates, hard-coded colours and sizes with plain-language cards', async () => {
    const result = await runCheck({ source: product });
    const keys = result.violations.filter((violation) => violation.status === 'new').map((violation) => `${violation.title}@${violation.file}:${violation.line}`);
    expect(keys).toEqual(expect.arrayContaining([
      '重复了@src/components/ui/legacy.tsx:2',
      '重复了@src/pages/Settings.tsx:1',
      '没用组件库@src/pages/Orders.tsx:6',
      '没用组件库@src/pages/Orders.tsx:7',
      '没用组件库@src/pages/Orders.tsx:9',
      '颜色写死了@src/pages/Orders.tsx:9',
      '颜色写死了@src/pages/Settings.tsx:2',
      '颜色写死了@src/styles.css:10',
      '尺寸写死了@src/pages/Orders.tsx:5',
    ]));
    // The library itself may contain raw elements; Clean.tsx uses the library correctly.
    expect(keys.some((key) => key.includes('button.tsx') || key.includes('tabs.tsx') || key.includes('Clean.tsx'))).toBe(false);
    const tab = result.violations.find((violation) => violation.file === 'src/pages/Orders.tsx' && violation.line === 7)!;
    expect(tab.suggestion).toMatchObject({ component: 'TabsTrigger', importHint: 'import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"' });
    const color = result.violations.find((violation) => violation.title === '颜色写死了' && violation.file === 'src/pages/Orders.tsx')!;
    expect(color.fix).toContain('primary');
    expect(result.violations.find((violation) => violation.title === '尺寸写死了' && violation.file === 'src/pages/Orders.tsx')!.fix).toBe('改成最接近的统一档位 p-3.5（14px）。');
  });

  it('suggests turning repeated markup into a component, identical and near-identical, largest block first', async () => {
    const result = await runCheck({ source: product });
    const patterns = result.violations.filter((violation) => violation.rule === 'basic/repeated-pattern');
    expect(patterns.map((violation) => [violation.file, violation.line, violation.level])).toEqual([
      ['src/pages/Reports.tsx', 6, 'reference'],
      ['src/pages/Reports.tsx', 4, 'reference'],
    ]);
    expect(patterns[0].what).toContain('差不多的写法出现了 4 次（2 个文件）');
    expect(patterns[0].fix).toContain('不同样式选项');
    expect(patterns[1].what).toContain('一模一样地出现了 3 次');
    // Smaller blocks inside the reported card (e.g. the <p> pairs) are not reported again.
    expect(patterns).toHaveLength(2);

    // Checking one file still sees the copies elsewhere, reports at that file, and keeps the same identity for baselines.
    const single = await runCheck({ source: product, files: ['src/pages/Stats.tsx'] });
    const local = single.violations.filter((violation) => violation.rule === 'basic/repeated-pattern');
    expect(local.map((violation) => [violation.file, violation.line])).toEqual([['src/pages/Stats.tsx', 5], ['src/pages/Stats.tsx', 4]]);
    expect(local.map((violation) => violation.fingerprint)).toEqual(patterns.map((violation) => violation.fingerprint));
  });

  it('lets a project require more copies before suggesting a component', async () => {
    const rulesPath = join(product, 'pattern-rules.json');
    await writeFile(rulesPath, JSON.stringify({ rules: [{ id: 'basic/repeated-pattern', minOccurrences: 5 }] }));
    try {
      const result = await runCheck({ source: product, rulesPath });
      expect(result.violations.filter((violation) => violation.rule === 'basic/repeated-pattern')).toEqual([]);
    } finally { await rm(rulesPath); }
    expect(() => buildRuleSet({ rules: [{ id: 'basic/repeated-pattern', minOccurrences: 1 }] })).toThrow(/minOccurrences/);
  });

  it('names every problem after what it is, not only its kind', async () => {
    const result = await runCheck({ source: product });
    const name = (file: string, line: number, title: string) => result.violations.find((violation) => violation.file === file && violation.line === line && violation.title === title)?.name;
    expect(name('src/pages/Orders.tsx', 7, '没用组件库')).toBe('「全部订单」标签页是手写的，应改用 TabsTrigger');
    expect(name('src/pages/Orders.tsx', 9, '没用组件库')).toBe('「提交订单并且继续」按钮是手写的，应改用 Button');
    expect(name('src/pages/Orders.tsx', 9, '颜色写死了')).toBe('「提交订单并且继续」的颜色写死成 #1a73e9');
    expect(name('src/pages/Orders.tsx', 5, '尺寸写死了')).toBe('区块的间距写死成 13px');
    expect(name('src/styles.css', 10, '颜色写死了')).toBe('样式文件里颜色写死成 #ff0000');
    expect(name('src/pages/Settings.tsx', 1, '重复了')).toBe('又写了一个 Button，组件库里已经有了');
    expect(name('src/components/ui/legacy.tsx', 2, '重复了')).toBe('组件库里有两个 Button');
    expect(name('src/pages/Reports.tsx', 6, '可以做成组件')).toBe('4 段相似的卡片（含「访客」），可以合成一个组件');
    expect(name('src/pages/Reports.tsx', 4, '可以做成组件')).toBe('这段页头（含「报表」）写了 3 份，可以做成组件');
    expect(new Set(result.violations.map((violation) => violation.name)).size).toBeGreaterThan(new Set(result.violations.map((violation) => violation.title)).size);
  });

  it('honours ignore comments only when they carry a reason', async () => {
    const result = await runCheck({ source: product, files: ['src/pages/Orders.tsx'] });
    const ignored = result.violations.filter((violation) => violation.status === 'ignored');
    expect(ignored).toMatchObject([{ line: 11, ignoreReason: '第三方嵌入要求原生按钮' }]);
    expect(result.ignoreWithoutReason).toEqual([{ file: 'src/pages/Orders.tsx', line: 13 }]);
    expect(result.violations.find((violation) => violation.line === 13)?.status).toBe('new');
  });

  it('checks only the given files but still knows about duplicates elsewhere in the library', async () => {
    const result = await runCheck({ source: product, files: [join(product, 'src/pages/Settings.tsx')] });
    expect(result.scope).toBe('files');
    expect(new Set(result.violations.map((violation) => violation.file))).toEqual(new Set(['src/pages/Settings.tsx']));
    expect(result.violations.find((violation) => violation.title === '重复了')?.what).toContain('src/components/ui/button.tsx');
    expect(result.violations.find((violation) => violation.title === '尺寸写死了')?.fix).toBe('去掉行内样式，改用类名 p-2.5，大小一样。');
  });

  it('records old problems in a baseline so only new ones count, and notices fixed ones', async () => {
    const baselinePath = join(product, '.uxqa/baseline.json');
    const before = await runCheck({ source: product });
    await writeBaseline(baselinePath, before);
    const same = await runCheck({ source: product, baselinePath });
    expect(same.summary).toMatchObject({ newMust: 0, newDefault: 0, baseline: before.violations.filter((violation) => violation.status !== 'ignored').length });

    const settings = join(product, 'src/pages/Settings.tsx');
    const original = await readFile(settings, 'utf8');
    try {
      // Fix the colour on a line that also has an old hard-coded size, and add one new problem.
      await writeFile(settings, `${original.replace('"#333333"', '"var(--primary)"')}\nexport function Extra() { return <button>新增</button>; }\n`);
      const after = await runCheck({ source: product, baselinePath });
      const fresh = after.violations.filter((violation) => violation.status === 'new');
      expect(fresh).toMatchObject([{ title: '没用组件库', file: 'src/pages/Settings.tsx', line: 9 }]);
      // The old padding problem on the edited line stays old; only the colour counts as fixed.
      expect(after.violations.find((violation) => violation.title === '尺寸写死了' && violation.file === 'src/pages/Settings.tsx')?.status).toBe('baseline');
      expect(after.baseline?.fixed).toBe(1);
    } finally {
      await writeFile(settings, original);
      await rm(baselinePath, { force: true });
    }
  });

  it('applies project rules: scale rules replace the generic size finding, text length and forbidden imports', async () => {
    const rulesPath = join(product, 'rules.json');
    await writeFile(rulesPath, JSON.stringify({ rules: [
      { id: 'spacing-scale', type: 'value-scale', property: 'spacing', allowed: 'multiple-of-4', level: 'must' },
      { id: 'short-buttons', type: 'text-length', max: 6, level: 'default' },
      { id: 'no-legacy', type: 'forbid-import', module: '@/components/ui/legacy', level: 'must' },
    ] }));
    await writeFile(join(product, 'src/pages/Legacy.tsx'), 'import { Button } from "@/components/ui/legacy";\nexport const Legacy = () => <Button />;\n');
    const result = await runCheck({ source: product, rulesPath });
    const at = (file: string, line: number) => result.violations.filter((violation) => violation.file === file && violation.line === line).map((violation) => violation.rule);
    expect(at('src/pages/Orders.tsx', 5)).toEqual(['spacing-scale']);
    expect(result.violations.find((violation) => violation.rule === 'short-buttons')?.what).toContain('提交订单并且继续');
    expect(result.violations.find((violation) => violation.rule === 'no-legacy')?.file).toBe('src/pages/Legacy.tsx');
    await rm(rulesPath);
    await rm(join(product, 'src/pages/Legacy.tsx'));
  });

  it('gives repeated blocks a merge plan: props from differing text, style options from differing styling, every site', async () => {
    const result = await runCheck({ source: product });
    const cards = result.violations.find((violation) => violation.rule === 'basic/repeated-pattern' && violation.name.includes('卡片'))!;
    expect(cards.plan).toEqual([
      '1. 在 src/components/ui/ 新建组件 InfoCard（这是暂定名，请按用途改成能说明它是什么的名字），结构照 src/pages/Reports.tsx:6 那一份，8 个各处都一样的样式写在组件里。',
      '2. 各处不一样的文字做成属性：title（访客 / 退款 / 订单 / 收入）；value（3,200 / 6 / 128 / ¥9,800）；change（+3% / -2% / +12% / +8%）。',
      '3. 各处不一样的样式做成样式选项 variant（名字可以按用途改，例如 up / down）：default（text-green-600）；red（text-red-600）。',
      '4. 把这 4 处换成新组件：src/pages/Reports.tsx:6 → <InfoCard title="访客" value="3,200" change="+3%" />；src/pages/Reports.tsx:7 → <InfoCard variant="red" title="退款" value="6" change="-2%" />；src/pages/Stats.tsx:5 → <InfoCard title="订单" value="128" change="+12%" />；src/pages/Stats.tsx:6 → <InfoCard title="收入" value="¥9,800" change="+8%" />。',
      '5. 换完重新检测，并在控制台对比这几页改前改后的截图，外观应当没有变化；有变化的逐条确认。',
    ]);
    expect(formatPrompt(result)).toContain('- 合并方案：\n  1. 在 src/components/ui/ 新建组件 InfoCard');
  });

  it('keeps people-facing text free of jargon and gives the AI exact locations', async () => {
    const result = await runCheck({ source: product });
    const text = formatText(result, { limit: 100 });
    for (const violation of result.violations) {
      for (const field of [violation.name, violation.title, violation.what, violation.consequence]) expect(field).not.toMatch(/Token|ARIA|DOM|WCAG|selector|overflow|z-index/i);
    }
    expect(text).toContain('会怎样：');
    const prompt = formatPrompt(result);
    expect(prompt).toMatch(/^请帮我修改这个项目（.+）的前端代码，解决下面 \d+ 个问题/);
    expect(prompt).toMatch(/问题 \d+【需要改】：.+\n- 位置：src\/pages\/Orders\.tsx:7（第 7 行）/);
    expect(prompt).toContain('修改要求：');
    expect(prompt).toContain('全部改完后：');
    expect(prompt).toMatch(/运行 uxqa check --source .+ --files .*src\/pages\/Orders\.tsx/);
    // The prompt is for people too: no rule ids or level codes.
    expect(prompt).not.toMatch(/basic\/|\bmust\b|\[default\]/);
  });
});

describe('command line and hooks', () => {
  const run = (args: string[], input?: string) => new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = execFile(process.execPath, ['--import', 'tsx', cli, ...args], { cwd: resolve('.') }, (error, stdout, stderr) => done({ code: error ? (error as { code?: number }).code ?? 1 : 0, stdout, stderr }));
    if (input !== undefined) { child.stdin?.end(input); }
  });

  it('exits 1 for new must-fix problems, 0 when clean and 2 for bad rules', async () => {
    expect((await run(['check', '--source', product])).code).toBe(1);
    expect((await run(['check', '--source', product, '--files', join(product, 'src/pages/Clean.tsx')])).code).toBe(0);
    const bad = join(product, 'bad.json');
    await writeFile(bad, '{"rules":[{"id":"x","type":"nope"}]}');
    const result = await run(['check', '--source', product, '--rules', bad]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('不认识');
    await rm(bad);
  }, 30_000);

  it('blocks a Claude Code write that bypasses the library and stays silent for clean or unrelated files', async () => {
    const event = (file: string, tool = 'Write') => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { file_path: file }, cwd: product });
    const blocked = await run(['hook', 'claude'], event(join(product, 'src/pages/Orders.tsx')));
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain('TabsTrigger');
    const clean = await run(['hook', 'claude'], event(join(product, 'src/pages/Clean.tsx'), 'Edit'));
    expect(clean).toMatchObject({ code: 0, stdout: '' });
    expect((await run(['hook', 'claude'], event(join(product, 'package.json')))).code).toBe(0);
    expect((await run(['hook', 'claude'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }))).code).toBe(0);

    const soft = join(product, 'src/pages/Soft.tsx');
    await writeFile(soft, 'export const Soft = () => <div className="p-[13px]">x</div>;\n');
    const advisory = await run(['hook', 'claude'], event(soft));
    expect(advisory.code).toBe(0);
    expect(JSON.parse(advisory.stdout).hookSpecificOutput.additionalContext).toContain('p-3.5');
    await rm(soft);
  }, 60_000);

  it('serves component lookups over MCP', async () => {
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_component', arguments: { query: '标签页' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'check_files', arguments: { files: ['src/pages/Orders.tsx'] } } },
    ].map((line) => JSON.stringify(line)).join('\n');
    const result = await run(['mcp', '--source', product], `${lines}\n`);
    const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(replies.map((reply) => reply.id)).toEqual([1, 2, 3, 4]);
    expect(replies[1].result.tools.map((tool: { name: string }) => tool.name)).toEqual(['diagnose_quality', 'quality_verification', 'find_component', 'list_components', 'get_rules', 'check_files', 'run_page_check', 'review_screenshots', 'submit_screenshot_review']);
    expect(replies[2].result.content[0].text).toContain('import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"');
    expect(replies[3].result.content[0].text).toContain('src/pages/Orders.tsx:7');
  }, 30_000);

  it('checks only staged files in the git hook', async () => {
    await exec('git', ['init', '-q', product]);
    await exec('git', ['-C', product, 'add', 'src/pages/Clean.tsx']);
    expect((await run(['hook', 'git', '--source', product])).code).toBe(0);
    await exec('git', ['-C', product, 'add', 'src/pages/Orders.tsx']);
    const blocked = await run(['hook', 'git', '--source', product]);
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain('提交已拦下');
  }, 30_000);
});
