import type { Page } from 'playwright';

export type Severity = 'blocking' | 'info';

export type Target =
  | { role: Parameters<Page['getByRole']>[0]; name?: string; exact?: boolean }
  | { label: string; exact?: boolean }
  | { text: string; exact?: boolean }
  | { placeholder: string; exact?: boolean }
  | { testId: string }
  | { css: string };

export type Step =
  | { action: 'firstTab'; lang: string }
  | { action: 'beforeLanguageSwitch'; lang: string }
  | { action: 'expectRecoveryResponse'; match: string }
  | { action: 'click'; target: Target }
  | { action: 'fill'; target: Target; value: string }
  | { action: 'press'; target: Target; key: string }
  | { action: 'selectOption'; target: Target; value: string }
  | { action: 'waitFor'; target: Target }
  | { action: 'waitForHidden'; target: Target }
  | { action: 'expectVisible'; target: Target }
  | { action: 'keyboard'; key: string }
  | { action: 'expectHidden'; target: Target }
  | { action: 'expectText'; target: Target; text: string; exact?: boolean }
  | { action: 'expectValue'; target: Target; value: string }
  | { action: 'expectEnabled'; target: Target }
  | { action: 'expectDisabled'; target: Target }
  | { action: 'expectFocused'; target: Target }
  | { action: 'expectCount'; target: Target; count: number }
  | { action: 'expectUrl'; url: string }
  | { action: 'expectRequestCount'; match: string; method?: string; count: number }
  | { action: 'expectAnnounced'; text: string };

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

/** Deterministic fault injection for one flow; matched with the same glob rules as expectUrl. */
export interface NetworkRule {
  match: string;
  method?: string;
  times?: number;
  delayMs?: number;
  abort?: 'failed' | 'timedout' | 'internetdisconnected' | 'connectionrefused';
  respond?: { status: number; json?: unknown; body?: string; contentType?: string; headers?: Record<string, string> };
}

export interface FlowConfig {
  scenario?: InteractionScenario;
  preparationSteps?: number;
  name: string;
  route?: string;
  requirement?: string;
  expected?: string;
  network?: NetworkRule[];
  offline?: boolean;
  steps: Step[];
}

export const INTERACTION_SCENARIOS = ['failure-recovery', 'save-focus', 'language-entry'] as const;
export type InteractionScenario = typeof INTERACTION_SCENARIOS[number];

export interface JourneyList {
  container: string;
  rows: string;
  fields: Record<string, string>;
  totalAttribute: string;
  saveAs?: string;
  equals?: string;
  where?: Record<string, string>;
  partitionWitness?: { field: string; baselines: Record<string,string> };
}

export interface BusinessJourney {
  name: string;
  requirement: string;
  phases: Array<{ name: string; actor: string; route: string; steps: Step[]; exactRoute?: boolean; continueOnPage?: boolean; list?: JourneyList; observe?: JourneyObservation[]; requires?: JourneyAssertion[]; assert?: JourneyAssertion[] }>;
  gaps: string[];
}

export interface JourneyObservation {
  id: string;
  target: Target;
  read: 'text' | 'value' | 'attribute' | 'display';
  attribute?: string;
  as?: 'number';
}

export interface JourneyPredicate {
  left: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
  right: { ref: string } | { value: string | number };
}

export interface JourneyAssertion extends JourneyPredicate {
  name: string;
  when?: JourneyPredicate;
  sameFact?: { object: [string, string]; field: [string, string]; version: [string, string] };
}

export type DataNature = 'real' | 'mock' | 'fixture' | 'mixed' | 'unknown';

export interface EvidenceConfig {
  productRoot?: string;
  environment?: string;
  dataNature: DataNature;
}

export interface NotApplicableEntry {
  check: string;
  reason: string;
}

export interface HarnessConfig {
  name: string;
  baseUrl: string;
  storageState?: string;
  routes: string[];
  viewports: ViewportConfig[];
  flows: FlowConfig[];
  journeys?: BusinessJourney[];
  actorStates?: Record<string, string>;
  evidence: EvidenceConfig;
  notApplicable: NotApplicableEntry[];
  options: {
    axe: boolean;
    axeTags: string[];
    bestPractice: 'info' | 'blocking' | 'off';
    screenshots: boolean;
    trace: 'on-failure' | 'always' | 'off';
    keyboard: boolean;
    maxTabStops: number;
    reflow: boolean;
    reflowExceptions: string[];
    reducedMotion: boolean;
  };
}

export interface Finding {
  id: string;
  severity: Severity;
  kind: 'page' | 'console' | 'network' | 'accessibility' | 'flow' | 'visual' | 'keyboard' | 'reflow' | 'motion';
  message: string;
  route: string;
  viewport: string;
  step?: string;
  requirement?: string;
  evidence?: string[];
}

/** Result vocabulary of the shared acceptance standard (Q-03). */
export type CheckStatus = 'pass' | 'fail' | 'blocked' | 'not-verified' | 'not-applicable';

export type Dimension = 'product' | 'design' | 'behavior' | 'data' | 'responsive' | 'accessibility' | 'engineering' | 'operations';

export interface CheckResult {
  id: string;
  check: string;
  dimension: Dimension;
  status: CheckStatus;
  route: string;
  viewport: string;
  detail: string;
  requirement?: string;
  flow?: string;
  dataNature?: DataNature;
  evidence?: string[];
}

export interface GitState {
  revision?: string;
  branch?: string;
  dirty?: boolean;
  changedFiles?: number;
  changed?: string[];
  error?: string;
}

export interface RunEvidence {
  uxqaVersion: string;
  baseUrl: string;
  environment?: string;
  dataNature: DataNature;
  browser?: string;
  headless: boolean;
  node: string;
  platform: string;
  product: { root?: string; git?: GitState };
}

export interface RunResult {
  coverage?: {
    sourceDirectories: string[];
    pages: Pick<CheckResult, 'route' | 'viewport' | 'status'>[];
    skippedChecks: Pick<CheckResult, 'check' | 'route' | 'viewport' | 'status' | 'detail'>[];
  };
  configName: string;
  startedAt: string;
  endedAt: string;
  findings: Finding[];
  artifacts: string[];
  checks: CheckResult[];
  evidence?: RunEvidence;
}
