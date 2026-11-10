import { describe, expect, it, vi } from 'vitest';
import { resolveTarget } from '../src/locator.js';

describe('resolveTarget', () => {
  it('maps user-facing target descriptions to Playwright locator calls', () => {
    const page = {
      getByRole: vi.fn(() => 'role-locator'),
      getByLabel: vi.fn(() => 'label-locator'),
      getByText: vi.fn(() => 'text-locator'),
      getByPlaceholder: vi.fn(() => 'placeholder-locator'),
      getByTestId: vi.fn(() => 'testid-locator'),
      locator: vi.fn(() => 'css-locator'),
    };

    expect(resolveTarget(page, { role: 'button', name: 'Save' })).toBe('role-locator');
    expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Save', exact: undefined });
    expect(resolveTarget(page, { label: 'Email' })).toBe('label-locator');
    expect(resolveTarget(page, { text: 'Saved' })).toBe('text-locator');
    expect(resolveTarget(page, { placeholder: 'Email' })).toBe('placeholder-locator');
    expect(resolveTarget(page, { testId: 'save-button' })).toBe('testid-locator');
    expect(resolveTarget(page, { css: '[data-state="open"]' })).toBe('css-locator');
  });
});
