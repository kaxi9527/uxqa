import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/check/run.js';
import { libraryLabel, readInventory } from '../src/inventory/read.js';
import { pullGitLibrary, safeGitUrl, validateSources } from '../src/inventory/sources.js';
import { buildRuleSet, RuleConfigError } from '../src/rules/load.js';

const exec = promisify(execFile);
let product: string;
let home: string;
let repo: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'uxqa-lib-home-'));
  process.env.UXQA_HOME = home;
  product = await mkdtemp(join(tmpdir(), 'uxqa-lib-product-'));
  await cp(resolve('examples/check-fixture'), product, { recursive: true });
  // Parent library 1: a company package already installed in node_modules, shipped with its sources.
  const pkg = join(product, 'node_modules/@acme/ui');
  await mkdir(join(pkg, 'src'), { recursive: true });
  await writeFile(join(pkg, 'package.json'), '{"name":"@acme/ui","version":"1.0.0"}');
  await writeFile(join(pkg, 'src/switch.tsx'), 'export function Switch(props: { checked?: boolean }) { return <button role="switch" aria-checked={props.checked} />; }\n');
  await writeFile(join(pkg, 'src/button.tsx'), 'export function Button() { return <button />; }\n');
  // Parent library 2: a git repository (a local one, so the test needs no network).
  repo = await mkdtemp(join(tmpdir(), 'uxqa-lib-repo-'));
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'package.json'), '{"name":"@acme/dialogs"}');
  await writeFile(join(repo, 'src/dialog.tsx'), 'export function Dialog() { return <div role="dialog" />; }\n');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']]) await exec('git', ['-C', repo, ...args]);
  await mkdir(join(product, '.uxqa'), { recursive: true });
  await writeFile(join(product, '.uxqa/rules.json'), JSON.stringify({ extends: 'uxqa:basic', libraries: [{ name: '公司组件库', package: '@acme/ui' }, { name: '弹窗库', git: `file://${repo}` }] }));
  await writeFile(join(product, 'src/pages/Prefs.tsx'), 'export function Prefs() {\n  return <div><button role="switch" aria-checked="true" /><div role="dialog">设置</div><button className="px-3">保存</button></div>;\n}\n');
});

afterAll(async () => {
  delete process.env.UXQA_HOME;
  for (const dir of [product, home, repo]) await rm(dir, { recursive: true, force: true });
});

describe('component libraries from several places', () => {
  it('refuses unsafe or ambiguous sources with plain messages', () => {
    expect(safeGitUrl('ext::sh -c touch% /tmp/x')).toBe(false);
    expect(safeGitUrl('https://github.com/acme/ui.git')).toBe(true);
    expect(validateSources([{ name: 'x', git: '--upload-pack=evil' }]).problems[0]).toContain('git 链接');
    expect(validateSources([{ name: 'x', root: 'a', package: 'b' }]).problems[0]).toContain('只写一个');
    expect(() => buildRuleSet({ libraries: [{ name: 'x' }] })).toThrow(RuleConfigError);
  });

  it('reads the project library first, then installed packages; a not-yet-pulled git library is reported, not fetched', async () => {
    const inventory = await readInventory(product);
    expect(inventory.libraries.map((library) => [library.name, library.kind, library.ready])).toEqual([['本项目组件库', 'auto', true], ['公司组件库', 'package', true], ['弹窗库', 'git', false]]);
    expect(inventory.issues.join()).toContain('还没拉取');
    // Button exists in the project library and the company one: the project's own (child) wins.
    expect(inventory.overrides).toEqual([{ name: 'Button', used: '本项目组件库', hidden: '公司组件库' }]);
    expect(inventory.components.find((component) => component.name === 'Switch')).toMatchObject({ library: '公司组件库', importPath: '@acme/ui', file: 'node_modules/@acme/ui/src/switch.tsx' });
    expect(libraryLabel(inventory)).toBe('本项目组件库（src/components/ui） + 公司组件库（@acme/ui）');
  });

  it('pulls a git library only when asked, then uses it', async () => {
    const pulled = await pullGitLibrary(home, { name: '弹窗库', git: `file://${repo}` });
    expect(pulled.commit).toMatch(/^[0-9a-f]{7,}$/);
    const inventory = await readInventory(product);
    expect(inventory.libraries.find((library) => library.name === '弹窗库')).toMatchObject({ ready: true, components: 1, importBase: '@acme/dialogs' });
  });

  it('tells the AI to use the parent library component, naming the library and its import', async () => {
    const result = await runCheck({ source: product, files: [join(product, 'src/pages/Prefs.tsx')] });
    const byName = (name: string) => result.violations.find((violation) => violation.rule === 'basic/use-library-component' && violation.name.includes(name));
    expect(byName('Switch')).toMatchObject({ fix: expect.stringContaining('组件库「公司组件库」里的 Switch'), suggestion: { importHint: 'import { Switch } from "@acme/ui"' } });
    expect(byName('Dialog')!.suggestion!.importHint).toBe('import { Dialog } from "@acme/dialogs"');
    // Plain buttons still map to the project's own Button.
    expect(byName('Button')!.suggestion!.importHint).toContain('@/components/ui/button');
  });
});
