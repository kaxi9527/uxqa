import { describe, expect, it } from 'vitest';
import { tokenHealthError } from '../src/components/tokens.js';

describe('upstream extraction health', () => {
  it('does not call an error page or a degraded extraction complete', () => {
    expect(tokenHealthError({httpStatus:403})).toMatch(/HTTP 403/);
    expect(tokenHealthError({errors:[{stage:'colors'}]})).toMatch(/colors/);
    expect(tokenHealthError({timeouts:['content']})).toMatch(/content/);
    expect(tokenHealthError({httpStatus:200,errors:[],timeouts:[]})).toBeUndefined();
  });
});
