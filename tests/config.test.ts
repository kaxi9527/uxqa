import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies reusable defaults around a required base URL', () => {
    const config = loadConfig({ baseUrl: 'https://example.com' });

    expect(config.name).toBe('uxqa-run');
    expect(config.routes).toEqual(['/']);
    expect(config.viewports).toEqual([
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]);
    expect(config.options).toEqual({
      axe: true, axeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'], bestPractice: 'info', screenshots: true, trace: 'on-failure',
      keyboard: true, maxTabStops: 80, reflow: true, reflowExceptions: [], reducedMotion: true,
    });
    expect(config.evidence).toEqual({ dataNature: 'unknown' });
    expect(config.notApplicable).toEqual([]);
  });

  it('rejects a missing or malformed base URL', () => {
    expect(() => loadConfig({})).toThrow(/baseUrl/i);
    expect(() => loadConfig({ baseUrl: 'localhost:3000' })).toThrow(/absolute URL/i);
  });

  it('rejects invalid viewports and unsupported actions', () => {
    expect(() =>
      loadConfig({ baseUrl: 'https://example.com', viewports: [{ name: 'bad', width: 0, height: 500 }] }),
    ).toThrow(/viewport/i);
    expect(() =>
      loadConfig({
        baseUrl: 'https://example.com',
        flows: [{ name: 'bad', steps: [{ action: 'hover', target: { text: 'x' } }] }],
      }),
    ).toThrow(/action/i);
  });

  it('keeps a URL path for default coverage and accepts clearing an input', () => {
    const config = loadConfig({baseUrl:'https://example.com/app/',flows:[{name:'clear',steps:[{action:'fill',target:{label:'Title'},value:''}]}]});
    expect(config.routes).toEqual(['/app/']);
    expect(config.flows[0].steps[0]).toMatchObject({value:''});
  });

  it('rejects unsupported roles, malformed exact options, duplicate viewports and foreign routes', () => {
    const flow = (target: unknown) => ({baseUrl:'https://example.com',flows:[{name:'invalid',steps:[{action:'click',target}]}]});
    expect(() => loadConfig(flow({role:'not-a-role'}))).toThrow(/role/i);
    expect(() => loadConfig(flow({label:'Email',exact:'false'}))).toThrow(/exact/i);
    expect(() => loadConfig({baseUrl:'https://example.com',routes:['https://other.example/settings']})).toThrow(/origin/i);
    expect(() => loadConfig({baseUrl:'https://example.com',viewports:[{name:'same',width:800,height:600},{name:'same',width:390,height:844}]})).toThrow(/unique/i);
  });

  it('parses requirement ids, fault injection rules and the new assertions', () => {
    const config = loadConfig({
      baseUrl: 'https://example.com',
      evidence: { productRoot: '../product', environment: 'staging', dataNature: 'fixture' },
      notApplicable: [{ check: 'real-device', reason: 'Desktop-only admin tool' }],
      flows: [{
        name: 'load error', requirement: 'REQ-012', expected: 'Keeps input and allows retry', offline: false,
        network: [{ match: '**/api/items', method: 'get', times: 1, respond: { status: 500, json: { error: 'x' } } }, { match: '/api/save', delayMs: 300 }],
        steps: [
          { action: 'keyboard', key: 'Tab' },
          { action: 'expectText', target: { role: 'alert' }, text: 'Could not load', exact: false },
          { action: 'expectValue', target: { label: 'Name' }, value: '' },
          { action: 'expectDisabled', target: { role: 'button', name: 'Save' } },
          { action: 'expectFocused', target: { label: 'Name' } },
          { action: 'expectCount', target: { css: 'li' }, count: 0 },
          { action: 'expectHidden', target: { text: 'Loading' } },
          { action: 'expectUrl', url: '**/settings' },
          { action: 'expectRequestCount', match: '**/api/save', method: 'post', count: 1 },
          { action: 'expectAnnounced', text: 'Saved' },
        ],
      }],
    });
    const [flow] = config.flows;
    expect(flow).toMatchObject({ requirement: 'REQ-012', expected: 'Keeps input and allows retry' });
    expect(flow.network?.[0]).toEqual({ match: '**/api/items', method: 'GET', times: 1, respond: { status: 500, json: { error: 'x' } } });
    expect(flow.steps.at(-2)).toEqual({ action: 'expectRequestCount', match: '**/api/save', method: 'POST', count: 1 });
    expect(config.evidence).toEqual({ productRoot: '../product', environment: 'staging', dataNature: 'fixture' });
    expect(config.notApplicable).toEqual([{ check: 'real-device', reason: 'Desktop-only admin tool' }]);
  });

  it('rejects ambiguous fault rules, reasonless not-applicable entries and unknown data natures', () => {
    const withRule = (rule: unknown) => ({ baseUrl: 'https://example.com', flows: [{ name: 'f', network: [rule], steps: [{ action: 'keyboard', key: 'Tab' }] }] });
    expect(() => loadConfig(withRule({ match: '**/api', abort: 'failed', respond: { status: 500 } }))).toThrow(/both/);
    expect(() => loadConfig(withRule({ match: '**/api' }))).toThrow(/abort, respond or delayMs/);
    expect(() => loadConfig(withRule({ match: '**/api', abort: 'nope' }))).toThrow(/abort/);
    expect(() => loadConfig(withRule({ match: '**/api', respond: { status: 42 } }))).toThrow(/status/);
    expect(() => loadConfig({ baseUrl: 'https://example.com', notApplicable: [{ check: 'real-device' }] })).toThrow(/reason/);
    expect(() => loadConfig({ baseUrl: 'https://example.com', notApplicable: [{ check: 'flow', reason: 'x' }] })).toThrow(/notApplicable.check/);
    expect(() => loadConfig({ baseUrl: 'https://example.com', evidence: { dataNature: 'live' } })).toThrow(/dataNature/);
    expect(() => loadConfig({ baseUrl: 'https://example.com', flows: [{ name: 'f', steps: [{ action: 'keyboard', key: 'Tab', target: { text: 'x' } }] }] })).toThrow(/target/);
    expect(() => loadConfig({ baseUrl: 'https://example.com', options: { bestPractice: 'loud' } })).toThrow(/bestPractice/);
  });
});
