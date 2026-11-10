import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routesFromSource } from '../src/capture/routes.js';
import { runCheck, type CheckResult } from '../src/check/run.js';
import { isScannable } from '../src/check/scan.js';
import { parseComponentFile } from '../src/check/templates/parse.js';
import { componentByName, readInventory } from '../src/inventory/read.js';
import { importHint } from '../src/check/messages.js';

const VUE = resolve('examples/vue-fixture');
const SVELTE = resolve('examples/svelte-fixture');
// [rule, file:line:column, status], ordered by place then rule, so a whole check result can be compared at once.
const sorted = (rows: string[][]) => [...rows].sort((a, b) => {
  const [fileA, lineA, columnA] = a[1].split(/:(?=\d)/);
  const [fileB, lineB, columnB] = b[1].split(/:(?=\d)/);
  return fileA.localeCompare(fileB) || Number(lineA) - Number(lineB) || Number(columnA) - Number(columnB) || a[0].localeCompare(b[0]);
});
const list = (result: CheckResult) => sorted(result.violations.map((violation) => [violation.rule, `${violation.file}:${violation.line}:${violation.column}`, violation.status]));

describe('Vue single-file components', () => {
  let result: CheckResult;
  beforeAll(async () => { result = await runCheck({ source: VUE }); });

  it('reads a shadcn-vue library: the .vue file with its folder index, cva options, props and defaults', async () => {
    const inventory = await readInventory(VUE);
    expect(inventory).toMatchObject({ source: 'shadcn', library: 'src/components/ui', importBase: '@/components/ui' });
    expect(inventory.components.map((component) => component.name)).toEqual(['Button', 'Card', 'Input']);
    expect(componentByName(inventory, 'Button')).toMatchObject({
      file: 'src/components/ui/button/Button.vue', importPath: '@/components/ui/button', label: '按钮', renders: 'button',
      variants: { variant: ['default', 'outline'], size: ['default', 'sm'] }, defaults: { variant: 'default', size: 'default' },
      styles: { name: 'buttonVariants', file: 'src/components/ui/button/index.ts' },
    });
    // Props read from `defineProps<{ size?: InputSize }>()` with a local type alias and a destructured default.
    expect(componentByName(inventory, 'Input')).toMatchObject({ importPath: '@/components/ui/input', variants: { size: ['sm', 'md'] }, defaults: { size: 'md' }, renders: 'input' });
    // Options API `props: { tone: { type: String as PropType<…>, default } }`; no index.ts, so the .vue file is imported directly.
    const card = componentByName(inventory, 'Card')!;
    expect(card).toMatchObject({ importPath: '@/components/ui/card/Card.vue', variants: { tone: ['plain', 'muted'] }, defaults: { tone: 'plain' } });
    expect(importHint(card, inventory)).toBe('import Card from "@/components/ui/card/Card.vue"');
    expect(inventory.tokens.find((token) => token.name === 'primary')).toMatchObject({ value: '#1a73e8', file: 'src/assets/main.css' });
  });

  it('finds every planted problem at its exact line and column, and nothing else', () => {
    expect(list(result)).toEqual(sorted([
      ['basic/keep-focus-outline', 'src/App.vue:11:1', 'new'],
      ['basic/no-hardcoded-color', 'src/App.vue:14:3', 'new'],
      ['basic/no-transition-all', 'src/App.vue:15:1', 'new'],
      ['basic/no-duplicate-component', 'src/components/Button.vue:1:1', 'new'],
      ['basic/use-library-component', 'src/components/Button.vue:2:3', 'new'],
      ['basic/repeated-pattern', 'src/views/HomeView.vue:9:5', 'new'],
      ['basic/icon-button-name', 'src/views/HomeView.vue:21:5', 'new'],
      ['basic/no-arbitrary-size', 'src/views/OrdersView.vue:13:15', 'new'],
      ['basic/use-library-component', 'src/views/OrdersView.vue:14:5', 'new'],
      ['basic/no-hardcoded-color', 'src/views/OrdersView.vue:14:20', 'new'],
      ['basic/input-needs-label', 'src/views/OrdersView.vue:15:5', 'new'],
      ['basic/use-library-component', 'src/views/OrdersView.vue:15:5', 'new'],
      ['basic/image-size', 'src/views/OrdersView.vue:16:5', 'new'],
      ['basic/img-alt', 'src/views/OrdersView.vue:16:5', 'new'],
      ['basic/clickable-needs-button', 'src/views/OrdersView.vue:17:5', 'new'],
      ['basic/link-needs-href', 'src/views/OrdersView.vue:18:5', 'new'],
      ['basic/no-hardcoded-color', 'src/views/OrdersView.vue:19:22', 'new'],
      ['basic/no-arbitrary-size', 'src/views/OrdersView.vue:19:40', 'new'],
      ['basic/no-huge-z-index', 'src/views/OrdersView.vue:20:28', 'new'],
      ['basic/new-window-safety', 'src/views/OrdersView.vue:21:5', 'new'],
      ['basic/use-library-component', 'src/views/OrdersView.vue:23:5', 'ignored'],
      ['basic/use-library-component', 'src/views/OrdersView.vue:25:5', 'new'],
    ]));
    // The library itself (attributes fall through to a component's root element) and SettingsView.vue (correct use,
    // plus :class / :type / :src bound to data) stay silent.
    expect(result.violations.filter((violation) => violation.file.startsWith('src/components/ui/') || violation.file === 'src/views/SettingsView.vue')).toEqual([]);
  });

  it('names problems after what they are', () => {
    const name = (where: string, rule: string) => result.violations.find((violation) => `${violation.file}:${violation.line}:${violation.column}` === where && violation.rule === rule)?.name;
    expect(name('src/views/OrdersView.vue:14:5', 'basic/use-library-component')).toBe('「提交订单」按钮是手写的，应改用 Button');
    expect(name('src/views/OrdersView.vue:14:20', 'basic/no-hardcoded-color')).toBe('「提交订单」的颜色写死成 #1a73e9');
    expect(name('src/views/OrdersView.vue:15:5', 'basic/input-needs-label')).toBe('「搜索订单」输入框没有标签');
    expect(name('src/views/OrdersView.vue:19:22', 'basic/no-hardcoded-color')).toBe('行内样式的颜色写死成 #ff0000');
    expect(name('src/views/OrdersView.vue:13:15', 'basic/no-arbitrary-size')).toBe('区块的间距写死成 13px');
    expect(name('src/views/HomeView.vue:21:5', 'basic/icon-button-name')).toBe('只有图标的 Button 组件没有名字');
    expect(name('src/views/HomeView.vue:9:5', 'basic/repeated-pattern')).toBe('这段卡片（含「访客」）写了 3 份，可以做成组件');
    expect(name('src/components/Button.vue:1:1', 'basic/no-duplicate-component')).toBe('又写了一个 Button，组件库里已经有了');
  });

  it('gives fixes that fit a Vue project', () => {
    const button = result.violations.find((violation) => violation.file === 'src/views/OrdersView.vue' && violation.line === 14 && violation.rule === 'basic/use-library-component')!;
    expect(button.suggestion?.importHint).toBe('import { Button } from "@/components/ui/button"');
    // The new style option belongs where buttonVariants is written.
    expect(button.fix).toContain('src/components/ui/button/index.ts 的 buttonVariants');
    expect(result.violations.find((violation) => violation.rule === 'basic/no-hardcoded-color' && violation.line === 14)!.fix).toContain('primary');
    const plan = result.violations.find((violation) => violation.rule === 'basic/repeated-pattern')!.plan!.join('\n');
    expect(plan).toContain('src/views/HomeView.vue:9 → <InfoCard title="访客" :description="visitors" />');
  });

  it('honours <!-- uxqa-ignore --> comments only with a reason', () => {
    expect(result.violations.find((violation) => violation.status === 'ignored')?.ignoreReason).toBe('第三方支付要求原生按钮');
    expect(result.ignoreWithoutReason).toEqual([{ file: 'src/views/OrdersView.vue', line: 25 }]);
  });

  it('checks a single .vue file (as the editor hook does) with the same findings', async () => {
    expect(isScannable('src/views/OrdersView.vue')).toBe(true);
    const single = await runCheck({ source: VUE, files: ['src/views/OrdersView.vue'] });
    expect(list(single)).toEqual(list(result).filter((row) => row[1].startsWith('src/views/OrdersView.vue:')));
  });

  it('reads vue-router paths, skipping parameters and relative child paths', async () => {
    expect(await routesFromSource(VUE)).toEqual(['/', '/orders', '/settings']);
  });
});

describe('Svelte components', () => {
  let result: CheckResult;
  beforeAll(async () => { result = await runCheck({ source: SVELTE }); });

  it('reads a Svelte library: export let (Svelte 4) and $props() (Svelte 5) style options, imported through $lib', async () => {
    const inventory = await readInventory(SVELTE);
    expect(inventory).toMatchObject({ source: 'convention', library: 'src/lib/components/ui' });
    expect(componentByName(inventory, 'Button')).toMatchObject({
      file: 'src/lib/components/ui/Button.svelte', importPath: '$lib/components/ui/Button.svelte', renders: 'button',
      variants: { variant: ['default', 'outline'], size: ['sm', 'md'] }, defaults: { variant: 'default', size: 'md' },
    });
    expect(componentByName(inventory, 'Input')).toMatchObject({ variants: { size: ['sm', 'md'] }, defaults: { size: 'md' }, renders: 'input' });
    expect(importHint(componentByName(inventory, 'Button')!, inventory)).toBe('import Button from "$lib/components/ui/Button.svelte"');
  });

  it('finds every planted problem at its exact line and column, and nothing else', () => {
    expect(list(result)).toEqual(sorted([
      ['basic/page-language', 'src/app.html:2:1', 'new'],
      ['basic/allow-zoom', 'src/app.html:5:1', 'new'],
      ['basic/no-duplicate-component', 'src/lib/Card.svelte:1:1', 'new'],
      ['basic/repeated-pattern', 'src/routes/(marketing)/about/+page.svelte:2:3', 'new'],
      ['basic/clickable-needs-button', 'src/routes/(marketing)/about/+page.svelte:7:3', 'new'],
      ['basic/icon-button-name', 'src/routes/+layout.svelte:8:3', 'new'],
      ['basic/use-library-component', 'src/routes/+layout.svelte:8:3', 'new'],
      ['basic/no-transition-all', 'src/routes/+layout.svelte:13:1', 'new'],
      ['basic/no-hardcoded-color', 'src/routes/+layout.svelte:14:29', 'new'],
      ['basic/use-library-component', 'src/routes/items/[id]/+page.svelte:6:1', 'new'],
      ['basic/no-wide-fixed-width', 'src/routes/orders/+page.svelte:10:21', 'new'],
      ['basic/use-library-component', 'src/routes/orders/+page.svelte:11:3', 'new'],
      ['basic/no-hardcoded-color', 'src/routes/orders/+page.svelte:11:26', 'new'],
      ['basic/input-needs-label', 'src/routes/orders/+page.svelte:12:3', 'new'],
      ['basic/use-library-component', 'src/routes/orders/+page.svelte:12:3', 'new'],
      ['basic/clickable-needs-button', 'src/routes/orders/+page.svelte:13:3', 'new'],
      ['basic/img-alt', 'src/routes/orders/+page.svelte:14:3', 'new'],
      ['basic/new-window-safety', 'src/routes/orders/+page.svelte:15:3', 'new'],
      ['basic/no-arbitrary-size', 'src/routes/orders/+page.svelte:16:27', 'new'],
      ['basic/no-huge-z-index', 'src/routes/orders/+page.svelte:16:42', 'new'],
      ['basic/no-hardcoded-color', 'src/routes/orders/+page.svelte:17:12', 'new'],
      ['basic/no-hardcoded-color', 'src/routes/orders/+page.svelte:17:49', 'new'],
      ['basic/no-positive-tabindex', 'src/routes/orders/+page.svelte:18:3', 'new'],
      ['basic/use-library-component', 'src/routes/orders/+page.svelte:18:3', 'new'],
      ['basic/button-type-in-form', 'src/routes/orders/+page.svelte:20:5', 'new'],
      ['basic/use-library-component', 'src/routes/orders/+page.svelte:20:5', 'new'],
      ['basic/no-hardcoded-color', 'src/routes/orders/+page.svelte:24:47', 'new'],
      ['basic/iframe-title', 'src/routes/orders/+page.svelte:25:3', 'new'],
    ]));
  });

  it('names problems after what they are and skips text that depends on {#if}', () => {
    const name = (where: string, rule: string) => result.violations.find((violation) => `${violation.file}:${violation.line}:${violation.column}` === where && violation.rule === rule)?.name;
    expect(name('src/routes/orders/+page.svelte:10:21', 'basic/no-wide-fixed-width')).toBe('宽度写死成 720px');
    expect(name('src/routes/orders/+page.svelte:17:12', 'basic/no-hardcoded-color')).toBe('「提示文字」的颜色写死成 #999999');
    expect(name('src/routes/orders/+page.svelte:17:49', 'basic/no-hardcoded-color')).toBe('行内样式的颜色写死成 #123456');
    expect(name('src/routes/orders/+page.svelte:20:5', 'basic/button-type-in-form')).toBe('表单里的「提交」按钮没写 type');
    expect(name('src/routes/+layout.svelte:8:3', 'basic/icon-button-name')).toBe('只有图标的按钮没有名字');
    // `{#if liked}已收藏{:else}收藏{/if}` is two labels, so the button is not named after either.
    expect(name('src/routes/items/[id]/+page.svelte:6:1', 'basic/use-library-component')).toBe('手写的按钮，应改用 Button');
    expect(name('src/routes/(marketing)/about/+page.svelte:2:3', 'basic/repeated-pattern')).toBe('3 段相似的卡片（含「关于我们」），可以合成一个组件');
  });

  it('writes the merge plan in Svelte syntax', () => {
    const plan = result.violations.find((violation) => violation.rule === 'basic/repeated-pattern')!.plan!.join('\n');
    expect(plan).toContain('src/routes/+page.svelte:7 → <InfoCard variant="style2" title="新品" description="本周上架 {count} 件" label="查看" />');
  });

  it('reads SvelteKit routes from src/routes/**/+page.svelte, dropping (groups) and [params]', async () => {
    expect((await routesFromSource(SVELTE)).sort()).toEqual(['/', '/about', '/orders']);
  });
});

// The same mistakes as tests/hints.test.ts, written in Vue and in Svelte, each next to a correct version that must stay silent.
const VUE_BAD = `<template>
  <section>
    <div>
      <img src="/a.png" />
      <button @click="go"><svg /></button>
      <div @click="go">打开详情</div>
      <a>没有地址</a>
      <a href="#">假链接</a>
      <a href="https://example.com" target="_blank">外部网站</a>
      <span tabindex="3">插队</span>
      <input autofocus aria-label="搜索" />
      <input placeholder="你的邮箱" />
      <form><button>取消</button></form>
      <iframe src="/embed" />
      <button class="outline-none rounded">去掉焦点框</button>
      <span class="transition-all">动画</span>
      <span class="!text-red-500">强行覆盖</span>
      <div class="z-[9999]">最上层</div>
      <div class="w-[1200px]">很宽的盒子</div>
    </div>
  </section>
</template>
<style>
.a:focus { outline: none; }
.b { transition: all .2s; z-index: 99999; }
.c { width: 960px; color: red !important; }
.d { margin: 0 !important; }
</style>
`;

const VUE_GOOD = `<template>
  <section>
    <div>
      <img src="/a.png" alt="" width="40" height="40" />
      <button type="button" aria-label="关闭" @click="go"><svg /></button>
      <div role="button" tabindex="0" @click="go" @keydown="go">打开详情</div>
      <a href="/orders">订单</a>
      <a href="https://example.com" target="_blank" rel="noopener noreferrer">外部网站</a>
      <label>邮箱 <input placeholder="you@example.com" /></label>
      <input id="name" />
      <input type="file" class="hidden" />
      <form><button type="submit">提交</button></form>
      <iframe src="/embed" title="付款表单" />
      <button class="outline-none focus-visible:ring-2">有替代焦点样式</button>
      <div class="outline-none">不能获得焦点的容器</div>
      <span class="transition-colors">动画</span>
      <div class="z-50">弹层</div>
      <div class="overflow-x-auto"><table class="min-w-[900px]"><tbody /></table></div>
      <div class="max-w-[1200px]">限制最大宽度</div>
      <img :src="photo" :alt="caption" :class="sizeClass" />
      <a :href="link">动态链接</a>
      <div :role="kind" @click="go">动态角色</div>
      <input :type="kind" />
      <button :class="ring" class="outline-none">动态类名</button>
      <button v-html="label" />
      <input v-bind="field" />
      <!-- <img src="/commented.png"> -->
    </div>
  </section>
</template>
<style scoped lang="scss">
$brand: #ff0000;
.a:focus:not(:focus-visible) { outline: none; }
.a:focus-visible { outline: 2px solid; }
.b { transition: opacity .2s; z-index: 10; max-width: 960px; }
</style>
`;

const SVELTE_BAD = `<script>
  export let go;
</script>
<img src="/a.png" />
<button on:click={go}><svg /></button>
<div on:click={go}>打开详情</div>
<a>没有地址</a>
<a href="#">假链接</a>
<a href="https://example.com" target="_blank">外部网站</a>
<span tabindex="3">插队</span>
<input autofocus aria-label="搜索" />
<input placeholder="你的邮箱" />
<form><button>取消</button></form>
<iframe src="/embed"></iframe>
<button class="outline-none rounded">去掉焦点框</button>
<span class="transition-all">动画</span>
<span class="!text-red-500">强行覆盖</span>
<div class="z-[9999]">最上层</div>
<div class="w-[1200px]">很宽的盒子</div>
<style>
.a:focus { outline: none; }
.b { transition: all .2s; z-index: 99999; }
.c { width: 960px; color: red !important; }
.d { margin: 0 !important; }
</style>
`;

const SVELTE_GOOD = `<script lang="ts">
  let { go, photo, alt, link, kind, rest, items = [] } = $props();
</script>
<img src="/a.png" alt="" width="40" height="40" />
<button type="button" aria-label="关闭" onclick={go}><svg /></button>
<div role="button" tabindex="0" onclick={go} onkeydown={go}>打开详情</div>
<a href="/orders">订单</a>
<a href="https://example.com" target="_blank" rel="noopener noreferrer">外部网站</a>
<label>邮箱 <input placeholder="you@example.com" /></label>
<input id="name" />
<input type="file" class="hidden" />
<form><button type="submit">提交</button></form>
<iframe src="/embed" title="付款表单"></iframe>
<button class="outline-none focus-visible:ring-2">有替代焦点样式</button>
<div class="outline-none">不能获得焦点的容器</div>
<span class="transition-colors">动画</span>
<div class="z-50">弹层</div>
<div class="overflow-x-auto"><table class="min-w-[900px]"><tbody></tbody></table></div>
<div class="max-w-[1200px]">限制最大宽度</div>
<img src={photo} {alt} class:w-10={true} />
<a href={link}>动态链接</a>
<div role={kind} on:click={go}>动态角色</div>
<input type={kind} />
<input {...rest} />
<button class="outline-none {kind}">动态类名</button>
<button aria-label="关闭">{#if kind}<svg />{/if}</button>
{#each items as item}<a href="/i/{item.id}">{item.name}</a>{/each}
<svelte:head><title>标题</title></svelte:head>
`;

describe('the 18 common checks in Vue and Svelte markup', () => {
  let product: string;
  let result: CheckResult;
  beforeAll(async () => {
    product = await mkdtemp(join(tmpdir(), 'uxqa-templates-'));
    await mkdir(join(product, 'src'), { recursive: true });
    await writeFile(join(product, 'package.json'), '{"name":"templates","private":true}');
    await writeFile(join(product, 'src/Bad.vue'), VUE_BAD);
    await writeFile(join(product, 'src/Good.vue'), VUE_GOOD);
    await writeFile(join(product, 'src/Bad.svelte'), SVELTE_BAD);
    await writeFile(join(product, 'src/Good.svelte'), SVELTE_GOOD);
    result = await runCheck({ source: product });
  });
  afterAll(async () => { await rm(product, { recursive: true, force: true }); });

  const lines = (file: string, rule: string) => result.violations.filter((violation) => violation.file === file && violation.rule === rule).map((violation) => violation.line);

  for (const [file, offset, styleStart] of [['src/Bad.vue', 0, 24], ['src/Bad.svelte', 0, 21]] as const) {
    it(`finds each mistake once, on the right line, in ${file}`, () => {
      const expectations: Array<[string, number[]]> = [
        ['basic/img-alt', [4]], ['basic/image-size', [4]], ['basic/icon-button-name', [5]], ['basic/clickable-needs-button', [6]],
        ['basic/link-needs-href', [7, 8]], ['basic/new-window-safety', [9]], ['basic/no-positive-tabindex', [10]], ['basic/no-autofocus', [11]],
        ['basic/input-needs-label', [12]], ['basic/button-type-in-form', [13]], ['basic/iframe-title', [14]],
        ['basic/keep-focus-outline', [15, styleStart]], ['basic/no-transition-all', [16, styleStart + 1]], ['basic/no-important', [17, styleStart + 2]],
        ['basic/no-huge-z-index', [18, styleStart + 1]], ['basic/no-wide-fixed-width', [19, styleStart + 2]],
      ];
      for (const [rule, expected] of expectations) expect(lines(file, rule), rule).toEqual(expected.map((line) => line + offset));
      const name = (line: number, rule: string) => result.violations.find((violation) => violation.file === file && violation.line === line && violation.rule === rule)?.name;
      expect(name(6, 'basic/clickable-needs-button')).toBe('「打开详情」能点击，却用 <div> 写的');
      expect(name(12, 'basic/input-needs-label')).toBe('「你的邮箱」输入框没有标签');
      expect(name(13, 'basic/button-type-in-form')).toBe('表单里的「取消」按钮没写 type');
      expect(name(styleStart + 2, 'basic/no-important')).toContain('共 2 处');
    });
  }

  it('stays silent on correct markup and on anything bound to data', () => {
    const quiet = result.violations.filter((violation) => violation.file.includes('Good') && violation.rule !== 'basic/no-arbitrary-size');
    expect(quiet.map((violation) => `${violation.file}:${violation.line} ${violation.rule}`)).toEqual([]);
  });
});

describe('template parsing', () => {
  it('keeps exact offsets and does not mistake comments, strings, custom blocks or `<` in text for markup', () => {
    const text = '<template>\n  <div v-if="a > b" class="x">\n    <!-- <button>no</button> -->\n    <p>a < b</p><br><button>{{ n > 1 ? "多" : "少" }}</button>\n  </div>\n</template>\n<i18n>{ "a": "<button>no</button>" }</i18n>\n';
    const root = parseComponentFile(text, 'vue');
    const template = root.children.find((child) => child.type === 'element' && child.tag === 'template');
    const div = template?.type === 'element' ? template.children.find((child) => child.type === 'element') : undefined;
    expect(div?.type === 'element' && div.children.filter((child) => child.type === 'element').map((child) => child.type === 'element' ? `${child.tag}@${child.start}` : '')).toEqual([`p@${text.indexOf('<p>')}`, `br@${text.indexOf('<br>')}`, `button@${text.indexOf('<button>{{')}`]);
    const i18n = root.children.find((child) => child.type === 'element' && child.tag === 'i18n');
    expect(i18n?.type === 'element' && i18n.children).toEqual([]);
  });

  it('treats Svelte blocks as transparent and reads {…} inside attribute values', () => {
    const text = '{#each items as item}\n<a class="link {item.active ? "on" : ""}" title="x > y">{item.name}</a>\n{/each}\n';
    const root = parseComponentFile(text, 'svelte');
    const link = root.children.find((child) => child.type === 'element');
    expect(link?.type === 'element' && { tag: link.tag, start: link.start, attributes: link.attributes.map((attribute) => [attribute.name, attribute.kind, attribute.value, attribute.mixed ?? false]) }).toEqual({
      tag: 'a', start: text.indexOf('<a'), attributes: [['class', 'static', 'link {item.active ? "on" : ""}', true], ['title', 'static', 'x > y', false]],
    });
  });
});

describe('Nuxt pages', () => {
  let product: string;
  beforeAll(async () => {
    product = await mkdtemp(join(tmpdir(), 'uxqa-nuxt-'));
    await mkdir(join(product, 'pages/users'), { recursive: true });
    await writeFile(join(product, 'package.json'), '{"name":"nuxt-app","private":true,"devDependencies":{"nuxt":"^3.12.0"}}');
    for (const page of ['index.vue', 'about.vue', 'users/index.vue', 'users/[id].vue']) await writeFile(join(product, 'pages', page), '<template><main>页面</main></template>\n');
  });
  afterAll(async () => { await rm(product, { recursive: true, force: true }); });

  it('reads routes from pages/*.vue, skipping [params]', async () => {
    expect((await routesFromSource(product)).sort()).toEqual(['/', '/about', '/users']);
  });
});
