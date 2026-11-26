import { INTERACTION_SCENARIOS, type BusinessJourney, type DataNature, type FlowConfig, type HarnessConfig, type JourneyAssertion, type JourneyList, type JourneyObservation, type JourneyPredicate, type NetworkRule, type NotApplicableEntry, type Step, type Target, type ViewportConfig } from './types.js';

import { buildRequirementCheck } from './requirement-checks.js';

const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const TARGET_ACTIONS = new Set(['click', 'fill', 'press', 'selectOption', 'waitFor', 'waitForHidden', 'expectVisible', 'expectHidden', 'expectText', 'expectValue', 'expectEnabled', 'expectDisabled', 'expectFocused', 'expectCount']);
const PAGE_ACTIONS = new Set(['keyboard', 'expectUrl', 'expectRequestCount', 'expectAnnounced']);
const DEFAULT_AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DATA_NATURES = new Set<DataNature>(['real', 'mock', 'fixture', 'mixed', 'unknown']);
const ABORT_CODES = new Set(['failed', 'timedout', 'internetdisconnected', 'connectionrefused']);
/** Check ids that may be declared not applicable with a reason; declared checks are skipped, not silently passed. */
export const CHECK_IDS = ['axe', 'keyboard-focus', 'reflow-320', 'zoom-200', 'reduced-motion', 'screen-reader', 'tab-order-logic', 'design-fidelity', 'real-device', 'real-api', 'code-revision', 'engineering-gates', 'deployment', ...INTERACTION_SCENARIOS];
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

function stringMap(value: unknown, label: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value, label)).map(([key, entry]) => [key, stringValue(entry, label)]));
}

function parseObservation(value: unknown, known: Set<string>): JourneyObservation {
  const item = record(value, 'observation');
  const id = stringValue(item.id, 'observation.id');
  if (known.has(id)) throw new Error('Observation IDs must be unique within the scenario: ' + id);
  const read = item.read;
  if (read !== 'text' && read !== 'value' && read !== 'attribute' && read !== 'display') throw new Error('observation.read must be text, value, display or attribute');
  if (item.as !== undefined && item.as !== 'number') throw new Error('Only as: number is supported');
  if (read !== 'attribute' && item.attribute !== undefined) throw new Error('An attribute name needs read: attribute');
  known.add(id);
  return { id, target: parseTarget(item.target), read, ...(read === 'attribute' ? { attribute: stringValue(item.attribute, 'observation.attribute') } : {}), ...(item.as ? { as: 'number' } : {}) };
}

function parsePredicate(item: Record<string, unknown>, known: Set<string>): JourneyPredicate {
  const left = stringValue(item.left, 'predicate.left');
  const op = item.op;
  if (op !== 'eq' && op !== 'ne' && op !== 'gt' && op !== 'gte' && op !== 'lt' && op !== 'lte') throw new Error('Unsupported comparison operator');
  const right = record(item.right, 'predicate.right');
  if (Object.keys(right).length !== 1) throw new Error('Choose one right operand: ref or value');
  if (!known.has(left)) throw new Error('Unknown observation: ' + left);
  if (typeof right.ref === 'string') {
    if (!known.has(right.ref)) throw new Error('Unknown observation: ' + right.ref);
    return { left, op, right: { ref: right.ref } };
  }
  if (typeof right.value === 'string' || (typeof right.value === 'number' && Number.isFinite(right.value))) return { left, op, right: { value: right.value } };
  throw new Error('The right operand needs a known observation or a text/number literal');
}

function parseSameFact(value: unknown, known: Set<string>): NonNullable<JourneyAssertion['sameFact']> {
  const scope = record(value, 'sameFact');
  function pair(key: string): [string, string] {
    const ids = scope[key];
    if (!Array.isArray(ids) || ids.length !== 2 || ids[0] === ids[1] || !ids.every(id => known.has(id))) throw new Error('sameFact.' + key + ' needs two distinct observed references');
    return [ids[0], ids[1]];
  }
  const fields = { object: pair('object'), field: pair('field'), version: pair('version') };
  if (new Set(Object.values(fields).flat()).size !== 6) throw new Error('Object, field and version need their own observations');
  return fields;
}

export function parseJourney(value: unknown): BusinessJourney {
  const plan = record(value, 'journey');
  const snapshots = new Map<string, string[]>();
  const visitedActors = new Set<string>();
  const known = new Set<string>();
  if (!Array.isArray(plan.phases) || !plan.phases.length) throw new Error('journey.phases must be a non-empty array');
  const phases = plan.phases.map((raw) => {
    const phase = record(raw, 'phase');
    const actor = stringValue(phase.actor, 'phase.actor');
    const route = stringValue(phase.route, 'phase.route');
    if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\') || /[\x00-\x1f]/.test(route) || new URL(route, 'https://project.invalid').origin !== 'https://project.invalid') throw new Error('phase.route must be a project-relative URL starting with /');
    const steps = phase.steps ?? [];
    const stay = booleanOption(phase.continueOnPage, false, 'phase.continueOnPage');
    if (stay && !visitedActors.has(actor)) throw new Error('continueOnPage needs an earlier page for this actor');
    visitedActors.add(actor);
    if (!Array.isArray(steps)) throw new Error('phase.steps must be an array');
    let list: JourneyList | undefined;
    if (phase.list !== undefined) {
      const input = record(phase.list, 'phase.list');
      const fields = stringMap(input.fields, 'list.fields');
      const keys = Object.keys(fields).sort();
      if (!keys.length) throw new Error('list.fields must map stable keys to row attributes');
      list = { container: stringValue(input.container, 'list.container'), rows: stringValue(input.rows, 'list.rows'), fields, totalAttribute: stringValue(input.totalAttribute, 'list.totalAttribute') };
      if (input.equals !== undefined) {
        list.equals = stringValue(input.equals, 'list.equals');
        if (JSON.stringify(snapshots.get(list.equals)) !== JSON.stringify(keys)) throw new Error('list.equals needs an earlier snapshot with matching field names');
        if (input.where !== undefined) {
          list.where = stringMap(input.where, 'list.where');
          if (!Object.keys(list.where).every(key => keys.includes(key))) throw new Error('list.where must use snapshot fields');
        }
      } else if (input.where !== undefined) throw new Error('list.where needs list.equals');
      if (input.saveAs !== undefined) {
        list.saveAs = stringValue(input.saveAs, 'list.saveAs');
        if (snapshots.has(list.saveAs)) throw new Error('Snapshot names must be unique within a journey');
        snapshots.set(list.saveAs, keys);
      }
      if (!list.saveAs && !list.equals) throw new Error('A list needs saveAs or equals');
      if (input.partitionWitness !== undefined) {
        const partition = record(input.partitionWitness,'list.partitionWitness');
        const field = stringValue(partition.field,'partition field'), baselines=stringMap(partition.baselines,'role baselines');
        if (!keys.includes(field) || Object.keys(baselines).length<2 || Object.values(baselines).some(ref=>ref===list!.saveAs || JSON.stringify(snapshots.get(ref))!==JSON.stringify(keys))) throw new Error('Partition witness needs a recipient field and earlier comparable baselines for at least two recipients');
        list.partitionWitness={field,baselines};
      }
    }
    if (phase.observe !== undefined && !Array.isArray(phase.observe)) throw new Error('phase.observe must be an array');
    if (phase.assert !== undefined && !Array.isArray(phase.assert)) throw new Error('phase.assert must be an array');
    const observe = phase.observe?.map(item => parseObservation(item, known));
    if (phase.requires !== undefined && !Array.isArray(phase.requires)) throw new Error('phase.requires must be an array');
    const requires = phase.requires?.map(raw => {
      const item = record(raw,'prerequisite');
      return {name:stringValue(item.name,'prerequisite.name'),...parsePredicate(item,known)};
    });
    const assertions = phase.assert?.map(raw => {
      const item = record(raw, 'assertion');
      const predicate = parsePredicate(item, known);
      const sameFact = item.sameFact !== undefined ? parseSameFact(item.sameFact, known) : undefined;
      if (sameFact && (predicate.op !== 'eq' || !('ref' in predicate.right) || predicate.left === predicate.right.ref || Object.values(sameFact).flat().some(id => id === predicate.left || ('ref' in predicate.right && id === predicate.right.ref)))) throw new Error('Same-fact checks compare two independent observed values for equality');
      return { name: stringValue(item.name, 'assertion.name'), ...predicate, ...(sameFact ? { sameFact } : {}), ...(item.when !== undefined ? { when: parsePredicate(record(item.when, 'assertion.when'), known) } : {}) };
    });
    if (!steps.length && !list && !observe?.length && !assertions?.length) throw new Error('A phase needs an operation, observation or assertion');
    return { name: stringValue(phase.name, 'phase.name'), actor, route, steps: steps.map(parseStep), ...(booleanOption(phase.exactRoute,false,'phase.exactRoute') ? {exactRoute:true}:{}), ...(stay ? {continueOnPage:true}:{}), ...(list ? { list } : {}), ...(observe?.length ? { observe } : {}), ...(requires?.length ? {requires}:{}), ...(assertions?.length ? { assert: assertions } : {}) };
  });
  const gaps = stringArray(plan.gaps, [], 'journey.gaps');
  if (!gaps.length && !phases.some(p => p.assert?.length || p.list?.equals || p.steps.some(s => s.action.startsWith('expect')))) throw new Error('A scenario needs an assertion or an explicit evidence gap');
  return { name: stringValue(plan.name, 'journey.name'), requirement: stringValue(plan.requirement, 'journey.requirement'), phases, gaps };
}

function parseNotApplicable(value: unknown): NotApplicableEntry {
  const entry = record(value, 'notApplicable entry');
  const check = stringValue(entry.check, 'notApplicable.check');
  if (!CHECK_IDS.includes(check)) throw new Error(`notApplicable.check must be one of ${CHECK_IDS.join(', ')}`);
  return { check, reason: stringValue(entry.reason, 'notApplicable.reason') };
}

function parseInteractionScenario(value: unknown): FlowConfig {
  const s = record(value, 'scenario');
  const type = INTERACTION_SCENARIOS.find(id => id === s.type);
  if (!type) throw new Error('Unknown interaction scenario: ' + String(s.type));
  const route = stringValue(s.route, 'scenario.route');
  const setup = s.setup ?? [];
  if (!Array.isArray(setup)) throw new Error('scenario.setup must be an array of flow steps');
  const steps = setup.map(parseStep);
  const name = s.name === undefined ? type + ' ' + route.split(/[?#]/)[0] : stringValue(s.name, 'scenario.name');
  const flow: FlowConfig = { name, scenario: type, route, steps, preparationSteps: steps.length };
  const target = (key: string) => parseTarget(s[key]);
  if (type === 'failure-recovery') {
    const match = stringValue(s.request, 'scenario.request');
    const error = target('error'), ready = target('ready');
    flow.requirement = '首次读取失败后恢复内容并清除旧错误 / Recover content and clear the stale error';
    flow.network = [{ match, method: 'GET', times: 1, respond: { status: 503, json: { error: 'Temporarily unavailable' } } }];
    steps.push({ action: 'expectVisible', target: error });
    if (s.retry) steps.push({ action: 'click', target: target('retry') });
    steps.push({ action: 'expectRecoveryResponse', match }, { action: 'expectVisible', target: ready }, { action: 'expectHidden', target: error });
  } else if (type === 'save-focus') {
    const save = target('save'), saved = target('saved');
    flow.requirement = '键盘保存成功后焦点抵达预期控件 / Continue at the intended control after keyboard save';
    steps.push({ action: 'waitFor', target: save }, { action: 'expectHidden', target: saved });
    flow.preparationSteps = steps.length;
    steps.push({ action: 'press', target: save, key: 'Enter' }, { action: 'expectVisible', target: saved }, { action: 'expectFocused', target: target('continuation') });
  } else {
    const lang = stringValue(s.lang, 'scenario.lang'), control = target('switcher');
    const entry = target('entry');
    if (!('role' in entry) || !entry.name) throw new Error('scenario.entry needs a role and the expected accessible name');
    flow.requirement = '切换语言后的首个键盘入口使用目标语言 / First keyboard entry uses the selected language';
    steps.push({ action: 'waitFor', target: control }, { action: 'beforeLanguageSwitch', lang });
    flow.preparationSteps = steps.length;
    steps.push(s.option === undefined ? {action:'click', target: control} : {action:'selectOption', target:control, value:stringValue(s.option,'scenario.option')},
      { action: 'firstTab', lang }, { action: 'expectFocused', target: { ...entry, exact:true } });
  }
  return flow;
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
  const readiness = Object.fromEntries(Object.entries(record(source.readiness ?? {}, 'readiness')).map(([route, value]) => {
    if (!routes.includes(route)) throw new Error('Readiness route is not configured: ' + route);
    const entry = record(value, 'readiness entry');
    const selector = stringValue(entry.selector, 'readiness.selector');
    const timeoutMs = entry.timeoutMs === undefined ? 8000 : nonNegativeInteger(entry.timeoutMs, 'readiness.timeoutMs');
    if (timeoutMs < 1 || timeoutMs > 60000) throw new Error('readiness.timeoutMs must be between 1 and 60000');
    return [route, {selector, timeoutMs}];
  }));

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
  if (source.scenarios !== undefined && !Array.isArray(source.scenarios)) throw new Error('scenarios must be an array');
  parsedFlows.push(...(source.scenarios ?? []).map(parseInteractionScenario));
  const exclusions = notApplicable.map(parseNotApplicable);
  if (parsedFlows.some(flow => flow.scenario && exclusions.some(entry => entry.check === flow.scenario))) throw new Error('A bound interaction scenario cannot also be declared not applicable');
  const journeys = source.journeys ?? [];
  if (!Array.isArray(journeys)) throw new Error('journeys must be an array');
  const specialist = source.requirementChecks ?? [];
  if (!Array.isArray(specialist)) throw new Error('requirementChecks must be an array');
  const plans=[...journeys,...specialist.map((value,index)=>{
    try {
      const item=record(value,'requirement check');
      return buildRequirementCheck(item,typeof item.requirement==='string'?item.requirement:'');
    } catch(error){throw Error('requirementChecks['+index+']: '+(error instanceof Error?error.message:String(error)));}
  })].map(parseJourney);
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
    ...(plans.length ? { journeys: plans } : {}),
    ...(source.actorStates === undefined ? {} : { actorStates: stringMap(source.actorStates, 'actorStates') }),
    evidence: {
      ...(rawEvidence.productRoot === undefined ? {} : { productRoot: stringValue(rawEvidence.productRoot, 'evidence.productRoot') }),
      ...(rawEvidence.environment === undefined ? {} : { environment: stringValue(rawEvidence.environment, 'evidence.environment') }),
      dataNature: dataNature as DataNature,
    },
    notApplicable: exclusions,
    ...(Object.keys(readiness).length ? {readiness} : {}),
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
