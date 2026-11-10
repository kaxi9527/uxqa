import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditFigma, composite, contrast } from '../src/figma/audit.js';
import { runFigmaCommand } from '../src/figma/cli.js';
import { exportScripts } from '../src/figma/exporter.js';
import { renderFigmaReport } from '../src/figma/reports.js';
import { validateChunk, validateConfig, validateIndex } from '../src/figma/validate.js';
import type { FigmaChunk, FigmaComponent, FigmaConfig, FigmaIndex } from '../src/figma/types.js';
import { unpackCapture } from '../src/figma/transport.js';

const meta = { schemaVersion: 1 as const, exportId: 'test-round', fileKey: 'testFile', pageId: '1:1', capturedAt: '2026-11-02T10:00:00.000Z' };
const config: FigmaConfig = { fileKey: meta.fileKey, pageId: meta.pageId, themes: [{ name: 'Light', background: [1, 1, 1, 1] }] };
const component = (id = '1:2'): FigmaComponent => ({
  id, name: 'State=default', setId: '1:9', setName: 'Input', properties: { State: 'default', Size: 'md' }, width: 200, height: 36, disabled: false, icons: [], hitRegions: [],
  themes: [{ theme: 'Light', appearance: 'black', unknown: [], boundary: { id, color: [0, 0, 0, .5], inside: [1, 1, 1, 1], outside: [1, 1, 1, 1], weight: 1, align: 'INSIDE', variables: [] },
    texts: [{ id: '1:3', text: '保存设置', foreground: [0, 0, 0, 1], background: [1, 1, 1, 1], fontSize: 14, bold: false, clipped: false, disabled: false }] }],
});
const index = (ids = ['1:2']): FigmaIndex => ({ ...meta, kind: 'index', pageName: 'Test library', componentIds: ids, themes: ['Light'] });
const chunk = (components = [component()]): FigmaChunk => ({ ...meta, kind: 'components', components });
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

describe('Figma snapshot boundary', () => {
  it('rejects invalid config, empty inventories and unsupported versions', () => {
    expect(() => validateConfig({ ...config, pageId: '../../other' })).toThrow();
    expect(() => validateConfig({ ...config, themes: [{ name: 'Light', background: [1, 1, 1, .5] }] })).toThrow();
    expect(() => validateIndex(index([]))).toThrow(/Empty/);
    expect(() => validateIndex({ ...index(), schemaVersion: 2 })).toThrow(/schemaVersion/);
  });
  it('rejects scope drift, duplicated themes and unindexed components', () => {
    expect(() => validateChunk({ ...chunk(), pageId: '8:8' }, index())).toThrow(/scope/);
    expect(() => validateChunk({ ...chunk(), exportId: 'another-round' }, index())).toThrow(/scope/);
    expect(() => validateChunk(chunk([component('8:8')]), index())).toThrow(/outside/);
    const c = component(); c.themes.push(c.themes[0]);
    expect(() => validateChunk(chunk([c]), index())).toThrow(/duplicate/);
  });
  it('rejects nonfinite color data and missing themes', () => {
    const c = component(); c.themes[0].texts[0].foreground = [NaN, 0, 0, 1];
    expect(() => validateChunk(chunk([c]), index())).toThrow(/RGBA/);
    c.themes = []; expect(() => validateChunk(chunk([c]), index())).toThrow(/Missing theme/);
  });
  it('cannot pass omitted batches or duplicate components across batches', () => {
    const report = auditFigma(index(), []);
    expect(report.status).toBe('partial'); expect(report.verdict).toBe('needs-review'); expect(report.coverage.missingIds).toEqual(['1:2']);
    expect(() => auditFigma(index(), [chunk(), chunk()])).toThrow(/Duplicate/);
  });
});

describe('Figma design rules', () => {
  it('enforces explicit product tokens/fonts, while structure only creates review candidates', () => {
    const a = component(), b = component('1:4'); b.setId = '1:10'; b.setName = 'Another purpose';
    for (const c of [a, b]) c.structure = { signature: 'same-shape', nodes: 4, types: { FRAME: 1, TEXT: 3 } };
    a.fonts = ['Inter']; a.paintBindings = [{ id: 'VariableID:1:7', name: 'mother/gray', count: 1 }];
    const idx = index(['1:2', '1:4']); idx.forbiddenFonts = ['Inter']; idx.allowedColorPrefixes = ['colorA/']; idx.tokenObservations = [{ id: 'VariableID:1:7', theme: 'Light', expected: [0, 0, 0, 1], actual: [1, 1, 1, 1] }];
    const r = auditFigma(idx, [chunk([a, b])]);
    expect(r.summary.fail).toBe(2); expect(r.mergeCandidates[0].requiresSemanticReview).toBe(true); expect(r.catalog).toHaveLength(2);
  });
  it('composites alpha before contrast and distinguishes large text', () => {
    expect(contrast(composite([0, 0, 0, .5], [1, 1, 1, 1]), [1, 1, 1, 1])).toBeCloseTo(3.976, 2);
    const c = component(); c.themes[0].texts[0].foreground = [0, 0, 0, .5];
    expect(auditFigma(index(), [chunk([c])]).checks.find(x => x.rule === 'text-contrast')?.status).toBe('fail');
    c.themes[0].texts[0].fontSize = 24;
    expect(auditFigma(index(), [chunk([c])]).checks.find(x => x.rule === 'text-contrast')?.status).toBe('pass');
  });
  it('records unknown paint as unverified instead of treating it as a pass', () => {
    const c = component(); c.themes[0].texts[0].background = null; c.themes[0].unknown = ['unsupported-paint:GRADIENT_LINEAR'];
    const r = auditFigma(index(), [chunk([c])]); expect(r.summary['not-verified']).toBe(2); expect(r.verdict).toBe('needs-review');
  });
  it('excludes disabled variants and nested disabled text', () => {
    const c = component(); c.disabled = true; c.themes[0].texts[0].foreground = [1, 1, 1, 1];
    expect(auditFigma(index(), [chunk([c])]).summary.fail).toBe(0);
    c.disabled = false; c.themes[0].texts[0].disabled = true;
    expect(auditFigma(index(), [chunk([c])]).checks.some(x => x.rule === 'text-contrast')).toBe(false);
  });
  it('pairs only equivalent variant dimensions, and detects unchanged hover', () => {
    const base = component(), hover = component('1:4'); hover.properties.State = 'hover';
    const r = auditFigma(index(['1:2', '1:4']), [chunk([base, hover])]);
    expect(r.checks.find(x => x.rule === 'state-feedback')?.status).toBe('review');
    hover.themes[0].appearance = 'new-color';
    expect(auditFigma(index(['1:2', '1:4']), [chunk([base, hover])]).checks.find(x => x.rule === 'state-feedback')?.status).toBe('pass');
    hover.properties.Size = 'sm';
    expect(auditFigma(index(['1:2', '1:4']), [chunk([base, hover])]).checks.find(x => x.rule === 'state-feedback')?.status).toBe('not-verified');
  });
  it('treats tiny targets, overlaps, generic copy and clipping as review candidates', () => {
    const c = component(); c.setName = 'Button'; c.height = 20; c.themes[0].texts[0].text = '按钮'; c.themes[0].texts[0].clipped = true;
    c.hitRegions = [{ id: '1:10', x: 0, y: 0, width: 24, height: 24, opacity: 0 }, { id: '1:11', x: 20, y: 0, width: 24, height: 24, opacity: 0 }];
    const r = auditFigma(index(), [chunk([c])]);
    expect(r.checks.filter(x => x.status === 'review').map(x => x.rule)).toEqual(expect.arrayContaining(['target-size', 'hit-region-overlap', 'copy-placeholder', 'text-clipping']));
  });
  it('flags broken icon refs and same icons across tone variants', () => {
    const a = component(), b = component('1:4');
    for (const c of [a, b]) { c.setName = 'ToastShell'; c.icons = ['2:3']; }
    a.properties.Tone = 'success'; b.properties.Tone = 'error';
    expect(auditFigma(index(['1:2', '1:4']), [chunk([a, b])]).checks.some(x => x.rule === 'notice-tone-icons')).toBe(true);
    a.icons = ['MISSING:2:3']; expect(auditFigma(index(), [chunk([a])]).summary.fail).toBe(1);
  });
  it('escapes design content in reports', () => {
    const c = component(); c.name = '<script>alert(1)</script>'; c.height = 20; c.setName = 'Button';
    const rendered = renderFigmaReport(auditFigma(index(), [chunk([c])]));
    expect(rendered.html).not.toContain('<script>'); expect(rendered.html).toContain('&lt;script&gt;'); expect(rendered.html).toContain("default-src 'none'");
  });
});

describe('read-only collector', () => {
  it('decodes lossless dictionary captures without touching markers inside strings', () => {
    expect(unpackCapture({ encoding: 'uxqa-json-dictionary-v1', dictionary: ['long-key', '中文 @123'], payload: '{@0:@1,"literal":"@0"}' })).toEqual({ 'long-key': '中文 @123', literal: '@0' });
    expect(() => unpackCapture({ encoding: 'uxqa-json-dictionary-v1', dictionary: [], payload: '[@5]' })).toThrow(/reference/);
    expect(() => unpackCapture({ encoding: 'uxqa-json-dictionary-v1', dictionary: ['x'.repeat(100000)], payload: '[' + Array(30).fill('@0').join(',') + ']' })).toThrow(/2 MiB/);
  });
  it('executes with read APIs only, respects theme aliases and rejects wrong-page nodes', async () => {
    const scripts = exportScripts(config, meta.exportId);
    const page: any = { id: '1:1', type: 'PAGE', name: 'Page' };
    const root: any = { id: '1:2', type: 'COMPONENT', name: 'Input', parent: page, x: 10, y: 10, width: 200, height: 36, visible: true, opacity: 1, fills: [], strokes: [], variantProperties: {} };
    const text: any = { id: '1:3', type: 'TEXT', name: 'Label', characters: 'Save', parent: root, x: 0, y: 0, width: 40, height: 20, visible: true, opacity: 1, fontSize: 19, fontName: { family: 'Test', style: 'Semi Bold' }, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, boundVariables: { color: { id: 'VariableID:1:8' } } }], strokes: [] };
    root.children = [text]; page.findAllWithCriteria = () => [root];
    const figma = { fileKey: meta.fileKey, getNodeByIdAsync: async (id: string) => ({ '1:1': page, '1:2': root }[id]), setCurrentPageAsync: vi.fn(async () => {}), variables: {
      getVariableByIdAsync: async () => ({ variableCollectionId: 'c', valuesByMode: { 'm': { r: 0, g: 0, b: 0, a: 1 } } }),
      getVariableCollectionByIdAsync: async () => ({ id: 'c', modes: [{ name: 'Light', modeId: 'm' }] }),
    } };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const idx = await new AsyncFunction('figma', scripts.index)(figma); expect(idx.componentIds).toEqual(['1:2']);
    const code = scripts.collect.replace('const UXQA_IDS = [];', 'const UXQA_IDS = ["1:2"];');
    const result = await new AsyncFunction('figma', code)(figma);
    expect(validateChunk(result, idx).components[0].themes[0].texts[0]).toMatchObject({ foreground: [0, 0, 0, 1], bold: false });
    expect(root.children[0]).toBe(text); expect(text.characters).toBe('Save');
    root.parent = { id: '9:9', type: 'PAGE' };
    await expect(new AsyncFunction('figma', code)(figma)).rejects.toThrow(/outside/);
    expect(code).not.toMatch(/figma\.(?:create|notify|loadAllPages|setPluginData)|\.remove\(/);
  });
});

describe('Figma CLI evidence preservation', () => {
  it('runs a captured fixture, preserves input, refuses overwrite and symlinked output under input', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), 'uxqa-figma-')); dirs.push(dir);
    const input = join(dir, 'input'); const { mkdir } = await import('node:fs/promises'); await mkdir(input);
    const original = JSON.stringify(chunk()); await writeFile(join(input, 'index.json'), JSON.stringify(index())); await writeFile(join(input, 'chunk-001.json'), original);
    const out = join(dir, 'out'); expect(await runFigmaCommand(['check', '--input', input, '--out', out])).toBe(0);
    expect((await readdir(out)).sort()).toEqual(['figma.html', 'figma.json', 'figma.md']); expect(await readFile(join(input, 'chunk-001.json'), 'utf8')).toBe(original);
    expect(await runFigmaCommand(['check', '--input', input, '--out', out])).toBe(2);
    const alias = join(dir, 'alias'); await symlink(input, alias);
    expect(await runFigmaCommand(['check', '--input', input, '--out', join(alias, 'report')])).toBe(2);
    expect(await runFigmaCommand(['check', '--input', input, '--out', join(input, '..report')])).toBe(2);
  });
  it('returns 1 for incomplete collection and 2 for malformed data', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), 'uxqa-figma-')); dirs.push(dir);
    await writeFile(join(dir, 'index.json'), JSON.stringify(index()));
    const out = await mkdtemp(join(tmpdir(), 'uxqa-figma-report-')); dirs.push(out);
    expect(await runFigmaCommand(['check', '--input', dir, '--out', out])).toBe(1);
    await writeFile(join(dir, 'chunk-001.json'), '{invalid');
    expect(await runFigmaCommand(['check', '--input', dir, '--out', out + '-unused'])).toBe(2);
  });
});
