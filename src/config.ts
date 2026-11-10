import type { DataNature, FlowConfig, HarnessConfig, NetworkRule, NotApplicableEntry, Step, Target, ViewportConfig } from './types.js';

const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const TARGET_ACTIONS = new Set(['click', 'fill', 'press', 'selectOption', 'waitFor', 'expectVisible', 'expectHidden', 'expectText', 'expectValue', 'expectEnabled', 'expectDisabled', 'expectFocused', 'expectCount']);
const PAGE_ACTIONS = new Set(['keyboard', 'expectUrl', 'expectRequestCount', 'expectAnnounced']);
const DEFAULT_AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DATA_NATURES = new Set<DataNature>(['real', 'mock', 'fixture', 'mixed', 'unknown']);
const ABORT_CODES = new Set(['failed', 'timedout', 'internetdisconnected', 'connectionrefused']);
/** Check ids that may be declared not applicable with a reason; declared checks are skipped, not silently passed. */
export const CHECK_IDS = ['axe', 'keyboard-focus', 'reflow-320', 'zoom-200', 'reduced-motion', 'screen-reader', 'tab-order-logic', 'design-fidelity', 'real-device', 'real-api', 'code-revision', 'engineering-gates', 'deployment'];
const ROLES = new Set('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math meter menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem'.split(' '));

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseTarget(value: unknown): Target {
  const target = record(value, 'target');
  const keys = ['role', 'label', 'text', 'placeholder', 'testId', 'css'].filter((key) => key in target);
  if (keys.length !== 1) {
    throw new Error('target must specify exactly one of role, label, text, placeholder, testId, or css');
  }

  const key = keys[0];
  const raw = stringValue(target[key], `target.${key}`);
  if ('exact' in target && typeof target.exact !== 'boolean') throw new Error('target.exact must be boolean');
  if (key === 'role') {
    if (!ROLES.has(raw)) throw new Error(`Unsupported accessible role: ${raw}`);
    const result: Target = { role: raw as Extract<Target,{role:string}>['role'] };
    if ('name' in target) result.name = stringValue(target.name, 'target.name');
    if ('exact' in target && typeof target.exact !== 'boolean') throw new Error('target.exact must be boolean');
    if ('exact' in target) result.exact = target.exact as boolean;
    return result;
  }
  if (key === 'label') return { label: raw, ...(target.exact === undefined ? {} : { exact: Boolean(target.exact) }) };
  if (key === 'text') return { text: raw, ...(target.exact === undefined ? {} : { exact: Boolean(target.exact) }) };
  if (key === 'placeholder') return { placeholder: raw, ...(target.exact === undefined ? {} : { exact: Boolean(target.exact) }) };
  if (key === 'testId') return { testId: raw };
  return { css: raw };
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

function booleanOption(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function stringArray(value: unknown, fallback: string[], label: string): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) throw new Error(`${label} must be an array of non-empty strings`);
  return value as string[];
}

function parseStep(value: unknown): Step {
  const step = record(value, 'flow step');
  const action = stringValue(step.action, 'step.action');
  if (PAGE_ACTIONS.has(action)) {
    if ('target' in step) throw new Error(`${action} does not take a target`);
    if (action === 'keyboard') return { action, key: stringValue(step.key, 'step.key') };
    if (action === 'expectUrl') return { action, url: stringValue(step.url, 'step.url') };
    if (action === 'expectAnnounced') return { action, text: stringValue(step.text, 'step.text') };
    return {
      action: 'expectRequestCount',
      match: stringValue(step.match, 'step.match'),
      ...(step.method === undefined ? {} : { method: stringValue(step.method, 'step.method').toUpperCase() }),
      count: nonNegativeInteger(step.count, 'step.count'),
    };
  }
  if (!TARGET_ACTIONS.has(action)) throw new Error(`unsupported action: ${action}`);
  const target = parseTarget(step.target);

  if (action === 'fill') {
    if (typeof step.value !== 'string') throw new Error('step.value must be a string');
    return { action, target, value: step.value };
  }
  if (action === 'press') return { action, target, key: stringValue(step.key, 'step.key') };
  if (action === 'selectOption') return { action, target, value: stringValue(step.value, 'step.value') };
  if (action === 'expectText') {
    if ('exact' in step && typeof step.exact !== 'boolean') throw new Error('step.exact must be boolean');
    return { action, target, text: stringValue(step.text, 'step.text'), ...(step.exact === undefined ? {} : { exact: step.exact as boolean }) };
  }
  if (action === 'expectValue') {
    if (typeof step.value !== 'string') throw new Error('step.value must be a string');
    return { action, target, value: step.value };
  }
  if (action === 'expectCount') return { action, target, count: nonNegativeInteger(step.count, 'step.count') };
  return { action, target } as Step;
}

function parseNetworkRule(value: unknown): NetworkRule {
  const rule = record(value, 'network rule');
  const result: NetworkRule = { match: stringValue(rule.match, 'network.match') };
  if (rule.method !== undefined) result.method = stringValue(rule.method, 'network.method').toUpperCase();
  if (rule.times !== undefined) {
    result.times = nonNegativeInteger(rule.times, 'network.times');
    if (result.times === 0) throw new Error('network.times must be at least 1');
  }
  if (rule.delayMs !== undefined) {
    result.delayMs = nonNegativeInteger(rule.delayMs, 'network.delayMs');
    if (result.delayMs > 60_000) throw new Error('network.delayMs must not exceed 60000');
  }
  if (rule.abort !== undefined && rule.respond !== undefined) throw new Error('network rule cannot both abort and respond');
  if (rule.abort !== undefined) {
    if (typeof rule.abort !== 'string' || !ABORT_CODES.has(rule.abort)) throw new Error('network.abort must be failed, timedout, internetdisconnected or connectionrefused');
    result.abort = rule.abort as NetworkRule['abort'];
  }
  if (rule.respond !== undefined) {
    const respond = record(rule.respond, 'network.respond');
    const status = respond.status;
    if (!Number.isInteger(status) || Number(status) < 100 || Number(status) > 599) throw new Error('network.respond.status must be an HTTP status code');
    if ('json' in respond && 'body' in respond) throw new Error('network.respond accepts json or body, not both');
    if (respond.body !== undefined && typeof respond.body !== 'string') throw new Error('network.respond.body must be a string');
    if (respond.contentType !== undefined) stringValue(respond.contentType, 'network.respond.contentType');
    let headers: Record<string, string> | undefined;
    if (respond.headers !== undefined) {
      headers = {};
      for (const [key, header] of Object.entries(record(respond.headers, 'network.respond.headers'))) headers[key] = stringValue(header, `network.respond.headers.${key}`);
    }
    result.respond = {
      status: Number(status),
      ...('json' in respond ? { json: respond.json } : {}),
      ...(respond.body === undefined ? {} : { body: respond.body as string }),
      ...(respond.contentType === undefined ? {} : { contentType: respond.contentType as string }),
      ...(headers ? { headers } : {}),
    };
  }
  if (result.abort === undefined && result.respond === undefined && result.delayMs === undefined) throw new Error('network rule needs abort, respond or delayMs');
  return result;
}

function parseViewport(value: unknown): ViewportConfig {
  const viewport = record(value, 'viewport');
  const name = stringValue(viewport.name, 'viewport.name');
  const width = viewport.width;
  const height = viewport.height;
  if (!Number.isInteger(width) || Number(width) <= 0 || !Number.isInteger(height) || Number(height) <= 0) {
    throw new Error('viewport width and height must be positive integers');
  }
  return { name, width: Number(width), height: Number(height) };
}

function parseFlow(value: unknown): FlowConfig {
  const flow = record(value, 'flow');
  const steps = flow.steps;
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('flow.steps must be a non-empty array');
  if (flow.network !== undefined && !Array.isArray(flow.network)) throw new Error('flow.network must be an array');
  if (flow.offline !== undefined && typeof flow.offline !== 'boolean') throw new Error('flow.offline must be boolean');
  return {
    name: stringValue(flow.name, 'flow.name'),
    ...(flow.route === undefined ? {} : { route: stringValue(flow.route, 'flow.route') }),
    ...(flow.requirement === undefined ? {} : { requirement: stringValue(flow.requirement, 'flow.requirement') }),
    ...(flow.expected === undefined ? {} : { expected: stringValue(flow.expected, 'flow.expected') }),
    ...(flow.network === undefined ? {} : { network: (flow.network as unknown[]).map(parseNetworkRule) }),
    ...(flow.offline === undefined ? {} : { offline: flow.offline as boolean }),
    steps: steps.map(parseStep),
  };
}

function parseNotApplicable(value: unknown): NotApplicableEntry {
  const entry = record(value, 'notApplicable entry');
  const check = stringValue(entry.check, 'notApplicable.check');
  if (!CHECK_IDS.includes(check)) throw new Error(`notApplicable.check must be one of ${CHECK_IDS.join(', ')}`);
  return { check, reason: stringValue(entry.reason, 'notApplicable.reason') };
}

export function loadConfig(input: unknown): HarnessConfig {
  const source = record(input, 'config');
  const baseUrl = stringValue(source.baseUrl, 'baseUrl');
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    throw new Error('baseUrl must be an absolute URL');
  }

  const base = new URL(baseUrl);
  if (base.username || base.password) throw new Error('baseUrl must not contain credentials; use storageState');
  const routes = source.routes === undefined ? [`${base.pathname}${base.search}${base.hash}`] : source.routes;
  if (!Array.isArray(routes) || routes.length === 0 || routes.some((route) => typeof route !== 'string' || route.length === 0)) {
    throw new Error('routes must be a non-empty array of strings');
  }
  for (const route of routes) {
    if (new URL(route,baseUrl).origin !== base.origin) throw new Error('All routes must have the same origin as baseUrl');
  }
  if (new Set(routes).size !== routes.length) throw new Error('routes must be unique');

  const viewports = source.viewports === undefined ? DEFAULT_VIEWPORTS : source.viewports;
  if (!Array.isArray(viewports) || viewports.length === 0) throw new Error('viewports must be a non-empty array');

  const rawOptions = source.options === undefined ? {} : record(source.options, 'options');
  const axe = rawOptions.axe === undefined ? true : rawOptions.axe;
  const screenshots = rawOptions.screenshots === undefined ? true : rawOptions.screenshots;
  const trace = rawOptions.trace === undefined ? 'on-failure' : rawOptions.trace;
  if (typeof axe !== 'boolean' || typeof screenshots !== 'boolean') throw new Error('options.axe and options.screenshots must be boolean');
  if (trace !== 'on-failure' && trace !== 'always' && trace !== 'off') throw new Error('options.trace must be on-failure, always, or off');
  const axeTags = stringArray(rawOptions.axeTags, DEFAULT_AXE_TAGS, 'options.axeTags');
  if (axeTags.length === 0) throw new Error('options.axeTags must not be empty');
  const bestPractice = rawOptions.bestPractice === undefined ? 'info' : rawOptions.bestPractice;
  if (bestPractice !== 'info' && bestPractice !== 'blocking' && bestPractice !== 'off') throw new Error('options.bestPractice must be info, blocking, or off');
  const maxTabStops = rawOptions.maxTabStops === undefined ? 80 : nonNegativeInteger(rawOptions.maxTabStops, 'options.maxTabStops');
  if (maxTabStops < 1 || maxTabStops > 500) throw new Error('options.maxTabStops must be between 1 and 500');

  const rawEvidence = source.evidence === undefined ? {} : record(source.evidence, 'evidence');
  const dataNature = rawEvidence.dataNature === undefined ? 'unknown' : rawEvidence.dataNature;
  if (typeof dataNature !== 'string' || !DATA_NATURES.has(dataNature as DataNature)) throw new Error('evidence.dataNature must be real, mock, fixture, mixed, or unknown');
  const notApplicable = source.notApplicable === undefined ? [] : source.notApplicable;
  if (!Array.isArray(notApplicable)) throw new Error('notApplicable must be an array');

  const flows = source.flows === undefined ? [] : source.flows;
  if (!Array.isArray(flows)) throw new Error('flows must be an array');

  const parsedViewports = viewports.map(parseViewport);
  if (new Set(parsedViewports.map((viewport) => viewport.name)).size !== parsedViewports.length) throw new Error('viewport names must be unique');
  const parsedFlows = flows.map(parseFlow);
  if (new Set(parsedFlows.map((flow) => flow.name)).size !== parsedFlows.length) throw new Error('flow names must be unique');
  for (const flow of parsedFlows) {
    if (flow.route && !routes.includes(flow.route)) throw new Error(`Flow route is not configured for coverage: ${flow.route}`);
  }
  return {
    name: source.name === undefined ? 'uxqa-run' : stringValue(source.name, 'name'),
    baseUrl,
    ...(source.storageState === undefined ? {} : { storageState: stringValue(source.storageState, 'storageState') }),
    routes,
    viewports: parsedViewports,
    flows: parsedFlows,
    evidence: {
      ...(rawEvidence.productRoot === undefined ? {} : { productRoot: stringValue(rawEvidence.productRoot, 'evidence.productRoot') }),
      ...(rawEvidence.environment === undefined ? {} : { environment: stringValue(rawEvidence.environment, 'evidence.environment') }),
      dataNature: dataNature as DataNature,
    },
    notApplicable: notApplicable.map(parseNotApplicable),
    options: {
      axe, axeTags, bestPractice, screenshots, trace,
      keyboard: booleanOption(rawOptions.keyboard, true, 'options.keyboard'),
      maxTabStops,
      reflow: booleanOption(rawOptions.reflow, true, 'options.reflow'),
      reflowExceptions: stringArray(rawOptions.reflowExceptions, [], 'options.reflowExceptions'),
      reducedMotion: booleanOption(rawOptions.reducedMotion, true, 'options.reducedMotion'),
    },
  };
}
