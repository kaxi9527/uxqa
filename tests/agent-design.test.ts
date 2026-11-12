import { expect, it } from 'vitest';
import { makeDesignCandidate } from '../src/ui/agent-design.js';

const candidate = { name: 'Fixture', basis: 'Existing styles', typography: 'System type', spacing: 'Existing spacing', unknowns: 'Rendered states', colors: { background: '#ffffff', foreground: '#111111', primary: '#000000', onPrimary: '#ffffff', warning: '#ffff00', onWarning: '#111111' } };

it('calculates provided semantic pairs and preserves exact excerpts from read ranges', () => {
  const reads = new Map([['tokens.css', [{ start: 8, content: ':root {\n  --base: #fff;\n}' }]]]);
  const result = makeDesignCandidate({ ...candidate, sourceEvidence: [{ path: 'tokens.css', excerpt: '--base: #fff;' }], scales: { fontSize: { body: '1rem' }, lineHeight: { body: '1.5' }, space: { medium: '16px' }, radius: { control: '8px' }, duration: { fast: '150ms' } } }, reads);
  expect(result.sourceEvidence).toEqual([{ path: 'tokens.css', line: 9, excerpt: '--base: #fff;' }]);
  expect(result.contrastChecks.map((check) => check.foregroundRole)).toEqual(['foreground', 'onPrimary', 'onWarning']);
  expect(result.contrastChecks.every((check) => check.normalText45)).toBe(true);
  expect(result.css).toContain('--candidate-duration-fast: 150ms;');
  expect(makeDesignCandidate(candidate).provenance).toBe('unverified');
  const { onWarning: _unused, ...unpaired } = candidate.colors;
  expect(makeDesignCandidate({ ...candidate, colors: unpaired }).missingColorPairs).toEqual([{ foregroundRole: 'onWarning', backgroundRole: 'warning', missing: 'onWarning' }]);
});

it('rejects invented evidence and token values that cannot be emitted as CSS variables', () => {
  expect(() => makeDesignCandidate({ ...candidate, sourceEvidence: [{ path: 'tokens.css', excerpt: 'invented' }] })).toThrow('未在本轮读取');
  expect(() => makeDesignCandidate({ ...candidate, scales: { space: { medium: '1px; color:red' } } })).toThrow('值无效');
  expect(() => makeDesignCandidate({ ...candidate, scales: { unknown: { medium: '1px' } } })).toThrow('不支持设计变量');
});
