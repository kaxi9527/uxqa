import type { FigmaChunk, FigmaConfig, FigmaIndex } from './types.js';

type Obj = Record<string, unknown>;
const object = (v: unknown, path: string): Obj => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${path}: expected object`);
  return v as Obj;
};
const string = (v: unknown, path: string): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > 100000) throw new Error(`${path}: expected nonempty string`);
  return v;
};
const array = (v: unknown, path: string): unknown[] => {
  if (!Array.isArray(v) || v.length > 50000) throw new Error(`${path}: expected bounded array`);
  return v;
};
const finite = (v: unknown, path: string, min = 0): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new Error(`${path}: invalid number`);
  return v;
};
const bool = (v: unknown, path: string) => { if (typeof v !== 'boolean') throw new Error(`${path}: expected boolean`); };
const id = (v: unknown, path: string) => {
  const s = string(v, path);
  if (!/^(?:I)?\d+:\d+(?:;\d+:\d+)*$/.test(s)) throw new Error(`${path}: invalid Figma node ID`);
  return s;
};
function color(v: unknown, path: string, nullable = true): void {
  if (v === null && nullable) return;
  const a = array(v, path);
  if (a.length !== 4 || a.some(x => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1)) throw new Error(`${path}: expected RGBA in [0,1]`);
}
function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path}: duplicate values`);
}
function meta(v: Obj): void {
  if (v.schemaVersion !== 1) throw new Error('Unsupported Figma snapshot schemaVersion');
  if (!/^[a-zA-Z0-9_-]+$/.test(string(v.fileKey, 'fileKey'))) throw new Error('Invalid fileKey');
  id(v.pageId, 'pageId'); string(v.exportId, 'exportId');
  if (!Number.isFinite(Date.parse(string(v.capturedAt, 'capturedAt')))) throw new Error('Invalid capturedAt');
}
export function validateConfig(raw: unknown): FigmaConfig {
  const c = object(raw, 'config');
  if (!/^[a-zA-Z0-9_-]+$/.test(string(c.fileKey, 'fileKey'))) throw new Error('Invalid fileKey');
  id(c.pageId, 'pageId');
  const names = array(c.themes, 'themes').map((v, i) => {
    const t = object(v, `themes[${i}]`); string(t.name, 'theme.name'); color(t.background, 'theme.background', false);
    if ((t.background as number[])[3] !== 1) throw new Error('Theme background must be opaque');
    if (t.backgroundVariableId !== undefined && !/^VariableID:\d+:\d+$/.test(string(t.backgroundVariableId, 'backgroundVariableId'))) throw new Error('Invalid backgroundVariableId');
    return t.name as string;
  });
  if (!names.length || names.length > 8) throw new Error('Provide 1–8 explicit themes');
  unique(names, 'themes');
  for (const key of ['forbiddenFonts', 'allowedColorPrefixes']) if (c[key] !== undefined) array(c[key], key).forEach(x => string(x, key));
  if (c.tokenExpectations !== undefined) array(c.tokenExpectations, 'tokenExpectations').forEach(raw => {
    const t = object(raw, 'tokenExpectation');
    if (!/^VariableID:\d+:\d+$/.test(string(t.id, 'token.id')) || !names.includes(string(t.theme, 'token.theme'))) throw new Error('Invalid token expectation');
    color(t.expected, 'token.expected', false);
  });
  return c as unknown as FigmaConfig;
}
export function validateIndex(raw: unknown): FigmaIndex {
  const v = object(raw, 'index'); meta(v);
  if (v.kind !== 'index') throw new Error('Expected Figma index');
  string(v.pageName, 'pageName');
  const ids = array(v.componentIds, 'componentIds').map(x => id(x, 'componentIds'));
  if (!ids.length) throw new Error('Empty component inventory cannot be audited');
  unique(ids, 'componentIds');
  const themes = array(v.themes, 'themes').map(x => string(x, 'theme'));
  if (!themes.length) throw new Error('Empty themes'); unique(themes, 'themes');
  for (const key of ['forbiddenFonts', 'allowedColorPrefixes']) if (v[key] !== undefined) array(v[key], key).forEach(x => string(x, key));
  if (v.tokenObservations !== undefined) array(v.tokenObservations, 'tokenObservations').forEach(raw => {
    const t = object(raw, 'tokenObservation'); string(t.id, 'token.id');
    if (!themes.includes(string(t.theme, 'token.theme'))) throw new Error('Unknown token theme');
    color(t.expected, 'expected', false); color(t.actual, 'actual');
  });
  return v as unknown as FigmaIndex;
}
export function validateChunk(raw: unknown, index: FigmaIndex): FigmaChunk {
  const v = object(raw, 'chunk'); meta(v);
  if (v.kind !== 'components') throw new Error('Expected component chunk');
  for (const key of ['fileKey', 'pageId', 'exportId'] as const) if (v[key] !== index[key]) throw new Error(`Snapshot scope mismatch: ${key}`);
  const ids = array(v.components, 'components').map((rawComponent, i) => {
    const c = object(rawComponent, `components[${i}]`); const nodeId = id(c.id, 'component.id');
    if (!index.componentIds.includes(nodeId)) throw new Error(`Component outside indexed page: ${nodeId}`);
    string(c.name, 'component.name'); string(c.setName, 'setName'); if (c.setId !== null) id(c.setId, 'setId');
    for (const value of Object.values(object(c.properties, 'properties'))) string(value, 'variant value');
    finite(c.width, 'width'); finite(c.height, 'height'); bool(c.disabled, 'disabled');
    if (c.structure !== undefined) { const s = object(c.structure, 'structure'); string(s.signature, 'signature'); finite(s.nodes, 'structure.nodes'); Object.values(object(s.types, 'types')).forEach(x => finite(x, 'type count')); }
    for (const key of ['dependencies', 'paintBindings']) if (c[key] !== undefined) array(c[key], key).forEach(raw => { const d = object(raw, key); string(d.id, key + '.id'); string(d.name, key + '.name'); finite(d.count, key + '.count'); });
    if (c.fonts !== undefined) array(c.fonts, 'fonts').forEach(x => string(x, 'font'));
    if (c.unboundPaints !== undefined) finite(c.unboundPaints, 'unboundPaints');
    array(c.icons, 'icons').forEach(x => string(x, 'icon'));
    array(c.hitRegions, 'hitRegions').forEach(rawHit => {
      const h = object(rawHit, 'hitRegion'); id(h.id, 'hitRegion.id');
      finite(h.x, 'x', -Infinity); finite(h.y, 'y', -Infinity); finite(h.width, 'width'); finite(h.height, 'height');
      if (finite(h.opacity, 'opacity') > 1) throw new Error('opacity above 1');
    });
    const themes = array(c.themes, 'component.themes').map(rawTheme => {
      const t = object(rawTheme, 'theme'); const name = string(t.theme, 'theme.name');
      if (!index.themes.includes(name)) throw new Error('Unrequested theme');
      if (t.appearance !== null) string(t.appearance, 'appearance');
      array(t.unknown, 'unknown').forEach(x => string(x, 'unknown'));
      array(t.texts, 'texts').forEach(rawText => {
        const s = object(rawText, 'text'); id(s.id, 'text.id');
        if (typeof s.text !== 'string' || s.text.length > 100000) throw new Error('Invalid text');
        color(s.foreground, 'foreground'); color(s.background, 'background');
        if (s.fontSize !== null) finite(s.fontSize, 'fontSize'); if (s.bold !== null) bool(s.bold, 'bold'); bool(s.clipped, 'clipped'); bool(s.disabled, 'text.disabled');
      });
      if (t.boundary !== null) {
        const b = object(t.boundary, 'boundary'); id(b.id, 'boundary.id');
        color(b.color, 'boundary.color'); color(b.inside, 'inside'); color(b.outside, 'outside');
        if (b.weight !== null) finite(b.weight, 'weight'); string(b.align, 'align');
        array(b.variables, 'variables').forEach(x => string(x, 'variable'));
      }
      return name;
    });
    unique(themes, 'component themes');
    if (themes.length !== index.themes.length) throw new Error(`Missing theme for ${nodeId}`);
    return nodeId;
  });
  unique(ids, 'chunk components');
  return v as unknown as FigmaChunk;
}
