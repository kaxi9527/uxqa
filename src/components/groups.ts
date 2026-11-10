import { createHash } from 'node:crypto';
import type { ComponentCandidate, Observation } from './types.js';

export function groupObservations(observations: Observation[]): ComponentCandidate[] {
  const buckets = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = JSON.stringify([observation.family, observation.structure, observation.viewport]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(observation);
    buckets.set(key, bucket);
  }

  const candidates: ComponentCandidate[] = [];
  for (const [key, instances] of buckets) {
    const routes = [...new Set(instances.map((entry) => entry.route))].sort();
    if (routes.length < 2) continue;
    const differences: Record<string, string[]> = {};
    for (const property of [...new Set(instances.flatMap((entry) => Object.keys(entry.styles)))].sort()) {
      const values = [...new Set(instances.map((entry) => entry.styles[property] ?? '(unset)'))].sort();
      if (values.length > 1) differences[property] = values;
    }
    const suggestedProps = ['children'];
    if (Object.keys(differences).some((property) => /color|background|border|shadow/i.test(property))) suggestedProps.push('variant');
    if (Object.keys(differences).some((property) => /padding|gap|fontSize/i.test(property))) suggestedProps.push('size');
    const family = instances[0].family;
    const name = family.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('');
    candidates.push({
      id: `component-${createHash('sha256').update(key).digest('hex').slice(0,12)}`,
      name, family, viewport: instances[0].viewport, routes, occurrences: instances.length,
      reason: 'Matching bounded DOM structure and element family on multiple routes at the same viewport.',
      differences, suggestedProps, requiresHumanReview: true,
      instances: [...instances].sort((a,b) => `${a.route}:${a.state}:${a.selector}`.localeCompare(`${b.route}:${b.state}:${b.selector}`)),
    });
  }
  return candidates.sort((a,b) => b.routes.length - a.routes.length || a.id.localeCompare(b.id));
}
