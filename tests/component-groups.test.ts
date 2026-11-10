import { describe, expect, it } from 'vitest';
import { groupObservations } from '../src/components/groups.js';

function card(route: string, background = 'rgb(255, 255, 255)', viewport = 'desktop') {
  return {
    id: `${route}-${viewport}`, route, url: `http://example.test${route}`, state: 'initial',
    viewport, family: 'card', selector: 'article:nth-of-type(1)',
    structure: 'article(h2,p,button)', styles: { backgroundColor: background, padding: '16px' },
    bounds: { x: 0, y: 0, width: 300, height: 200 }, screenshot: `${route.slice(1)}.png`,
  };
}

describe('cross-page component candidates', () => {
  it('groups matching structure and retains style differences as possible variants', () => {
    const groups = groupObservations([card('/projects'), card('/events', 'rgb(0, 0, 0)')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      family: 'card', routes: ['/events', '/projects'], occurrences: 2,
      differences: { backgroundColor: ['rgb(0, 0, 0)', 'rgb(255, 255, 255)'] },
      suggestedProps: expect.arrayContaining(['children', 'variant']),
      requiresHumanReview: true,
    });
    expect(groups[0].instances.map((entry) => entry.screenshot)).toContain('events.png');
  });

  it('does not mistake repeated items on one route for cross-page reuse', () => {
    expect(groupObservations([card('/projects'), { ...card('/projects'), id: 'second' }])).toEqual([]);
  });

  it('does not group unrelated structure or compare different viewport layouts', () => {
    expect(groupObservations([card('/projects'), { ...card('/events'), structure: 'article(table)' }])).toEqual([]);
    expect(groupObservations([card('/projects'), card('/events', 'white', 'mobile')])).toEqual([]);
  });

  it('uses stable group ids independent of observation order', () => {
    const observations = [card('/projects'), card('/events')];
    expect(groupObservations(observations)[0].id).toBe(groupObservations([...observations].reverse())[0].id);
  });
});
