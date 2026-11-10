import { describe, expect, it } from 'vitest';
import { matchesUrl } from '../src/glob.js';

describe('matchesUrl', () => {
  it('matches path globs, full URL globs and query strings', () => {
    expect(matchesUrl('**/api/items', 'http://127.0.0.1:5000/api/items')).toBe(true);
    expect(matchesUrl('/api/items', 'http://127.0.0.1:5000/api/items?page=2')).toBe(true);
    expect(matchesUrl('/api/*', 'http://127.0.0.1:5000/api/items')).toBe(true);
    expect(matchesUrl('/api/*', 'http://127.0.0.1:5000/api/items/1')).toBe(false);
    expect(matchesUrl('/api/**', 'http://127.0.0.1:5000/api/items/1')).toBe(true);
    expect(matchesUrl('http://127.0.0.1:5000/settings', 'http://127.0.0.1:5000/settings')).toBe(true);
    expect(matchesUrl('/api/items.json', 'http://127.0.0.1:5000/api/itemsxjson')).toBe(false);
  });
});
