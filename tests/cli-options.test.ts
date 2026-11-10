import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli-options.js';

describe('CLI validation', () => {
  it('rejects unknown flags and missing flag values', () => {
    expect(() => parseArgs(['components', '--url', 'https://example.com', '--typo'])).toThrow(/unknown/i);
    expect(() => parseArgs(['components', '--url', '--out', 'reports'])).toThrow(/value/i);
  });
  it('accepts a source-only audit and preserves path arguments', () => {
    expect(parseArgs(['components', '--source', '/tmp/product with spaces', '--out', '/tmp/report'])).toMatchObject({
      command: 'components', source: '/tmp/product with spaces', out: '/tmp/report',
    });
  });
  it('supports an explicit faster audit without design-token extraction', () => {
    expect(parseArgs(['components','--url','https://example.com','--no-design-tokens'])).toMatchObject({designTokens:false});
  });
  it('requires library planning inputs and accepts a verified sync plan separately from discovery', () => {
    expect(parseArgs(['library','--source','src'])).toMatchObject({command:'library',source:'src'});
    expect(parseArgs(['component-plan','--source','src','--definition','record.json','--library','src/component-library'])).toMatchObject({command:'component-plan',definition:'record.json'});
    expect(parseArgs(['component-sync','--plan','component-plan.json'])).toMatchObject({command:'component-sync',plan:'component-plan.json'});
    expect(()=>parseArgs(['component-plan','--source','src'])).toThrow(/definition/i);
    expect(()=>parseArgs(['component-sync','--source','other','--plan','plan.json'])).toThrow(/plan|source/i);
  });
});
