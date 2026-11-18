import type { Page } from 'playwright';
import { resolveTarget } from './locator.js';
import type { JourneyAssertion, JourneyObservation, JourneyPredicate } from './types.js';

export type ObservedValue = { value: string | number } | { unavailable: string };
export type LogicVerdict = { name: string; status: 'pass' | 'fail' | 'not-verified'; detail: string };

export async function observeValue(page: Page, observation: JourneyObservation): Promise<ObservedValue> {
  const locator = resolveTarget(page, observation.target);
  try {
    const raw = await locator.evaluate((node, spec) => {
      if (node instanceof HTMLInputElement && node.type === 'password') return null;
      if (spec.read === 'attribute') return node.getAttribute(spec.attribute!);
      if (spec.read === 'text') return node instanceof HTMLElement ? node.innerText : node.textContent;
      return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement ? node.value : null;
    }, observation);
    if (raw === null) return { unavailable: 'Requested value unavailable' };
    if (observation.as !== 'number') return { value: raw };
    const number = Number(raw);
    return raw.trim() && Number.isFinite(number) ? { value: number } : { unavailable: 'Expected a numeric observation' };
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : String(error) };
  }
}

function compare(predicate: JourneyPredicate, facts: Map<string, ObservedValue>): { matches?: boolean; detail: string } {
  const left = facts.get(predicate.left);
  const right = 'ref' in predicate.right ? facts.get(predicate.right.ref) : predicate.right;
  if (!left || !('value' in left)) return { detail: 'Missing observation: ' + predicate.left };
  if (!right || !('value' in right)) return { detail: 'Missing right operand: ' + JSON.stringify(predicate.right) };
  const a = left.value, b = right.value;
  const detail = `${predicate.left} (${JSON.stringify(a)}) ${predicate.op} ${'ref' in predicate.right ? predicate.right.ref + ' ' : ''}(${JSON.stringify(b)})`;
  if (typeof a !== typeof b) return { detail: 'Incompatible types: ' + detail };
  if (predicate.op === 'eq') return { matches: a === b, detail };
  if (predicate.op === 'ne') return { matches: a !== b, detail };
  if (typeof a !== 'number' || typeof b !== 'number') return { detail: 'Numeric observations required: ' + detail };
  switch (predicate.op) {
    case 'gt': return { matches: a > b, detail };
    case 'gte': return { matches: a >= b, detail };
    case 'lt': return { matches: a < b, detail };
    case 'lte': return { matches: a <= b, detail };
  }
}

export function evaluateRelation(rule: JourneyAssertion, facts: Map<string, ObservedValue>): LogicVerdict {
  if (rule.sameFact) {
    for (const [key, [left, right]] of Object.entries(rule.sameFact)) {
      const a = facts.get(left), b = facts.get(right);
      if (!a || !('value' in a) || !String(a.value).trim() || !b || !('value' in b) || !String(b.value).trim() || a.value !== b.value) {
        return { name: rule.name, status: 'not-verified', detail: 'Comparable ' + key + ' not established: ' + left + ' / ' + right };
      }
    }
  }
  if (rule.when) {
    const condition = compare(rule.when, facts);
    if (condition.matches !== true) return { name: rule.name, status: 'not-verified', detail: 'Condition not witnessed: ' + condition.detail };
  }
  const result = compare(rule, facts);
  return { name: rule.name, status: result.matches === undefined ? 'not-verified' : result.matches ? 'pass' : 'fail', detail: result.detail };
}
