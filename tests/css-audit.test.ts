import { describe, expect, it } from 'vitest';
import { analyzeCss } from '../src/components/css.js';

describe('Project Wallace metrics', () => {
  it('reports real token use, style variety, spacing values and complexity', () => {
    const result = analyzeCss(':root{--brand:#1269aa;--space:16px}.card{color:var(--brand);padding:var(--space);gap:8px;font-size:14px}.other{color:red;margin:20px;font-size:16px;border-radius:4px}', 'fixture.css');
    expect(result.summary).toMatchObject({uniqueColors:2,uniqueFontSizes:2,definedTokens:2,usedTokens:2,unknownTokens:[]});
    expect(result.summary.spacingValues).toEqual(expect.arrayContaining(['var(--space)','8px','20px']));
    expect(result.summary.complexity).toBeGreaterThan(0);
    expect(result.metrics).toHaveProperty('selectors');
    expect(result.metrics).toHaveProperty('properties');
  });
  it('retains undeclared token references as observations rather than resolving them to guessed values', () => {
    expect(analyzeCss('.card{color:var(--missing);padding:16px}', 'partial.css').summary.unknownTokens).toEqual(['--missing']);
  });
});
