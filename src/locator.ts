import type { Target } from './types.js';

export interface LocatorPageLike<T> {
  getByRole(role: Extract<Target,{role:string}>['role'], options?: { name?: string; exact?: boolean }): T;
  getByLabel(label: string, options?: { exact?: boolean }): T;
  getByText(text: string, options?: { exact?: boolean }): T;
  getByPlaceholder(placeholder: string, options?: { exact?: boolean }): T;
  getByTestId(testId: string): T;
  locator(css: string): T;
}

export function resolveTarget<T>(page: LocatorPageLike<T>, target: Target): T {
  if ('role' in target) return page.getByRole(target.role, { name: target.name, exact: target.exact });
  if ('label' in target) return page.getByLabel(target.label, { exact: target.exact });
  if ('text' in target) return page.getByText(target.text, { exact: target.exact });
  if ('placeholder' in target) return page.getByPlaceholder(target.placeholder, { exact: target.exact });
  if ('testId' in target) return page.getByTestId(target.testId);
  return page.locator(target.css);
}
