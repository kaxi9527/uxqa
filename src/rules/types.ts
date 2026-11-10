import type { LibrarySource } from '../inventory/sources.js';
import type { HintCheck } from '../check/hints.js';

/** Rule strength follows the shared delivery standard: must → block, default → warn, reference → info. */
export type RuleLevel = 'must' | 'default' | 'reference' | 'off';

export type RuleType =
  | 'use-library-component'
  | 'require-library-component'
  | 'no-hardcoded-color'
  | 'no-arbitrary-size'
  | 'no-duplicate-component'
  | 'forbid-import'
  | 'require-prop'
  | 'text-length'
  | 'value-scale'
  | 'repeated-pattern'
  /** Built-in small checks (missing alt, icon buttons without a name, …); only the basic rules use it. */
  | 'ui-check';

export const RULE_TYPES: RuleType[] = ['use-library-component', 'require-library-component', 'no-hardcoded-color', 'no-arbitrary-size', 'no-duplicate-component', 'forbid-import', 'require-prop', 'text-length', 'value-scale', 'repeated-pattern'];

export interface Rule {
  id: string;
  type: RuleType;
  level: RuleLevel;
  /** Product-relative path globs; empty means everywhere outside the library. */
  include: string[];
  exclude: string[];
  /** Plain-language fix shown to people and passed to the AI. */
  fix?: string;
  reason?: string;
  origin: 'basic' | 'project';
  // Type-specific parameters
  element?: string;
  role?: string;
  inputType?: string;
  component?: string;
  module?: string;
  prop?: string;
  components?: string[];
  max?: number;
  property?: 'spacing' | 'font-size';
  allowed?: 'multiple-of-4' | number[];
  /** repeated-pattern: how many copies count as "repeated". Default 3, and then two 4+-element copies in different files also count. */
  minOccurrences?: number;
  /** ui-check: which built-in check. */
  check?: HintCheck;
}

/** A rule written in plain language; kept as guidance for the AI but never counted as checked. */
export interface GuidanceRule {
  id: string;
  text: string;
  level: RuleLevel;
}

export interface RuleSet {
  extends?: string;
  libraryRoot?: string;
  /** Library sources in priority order (child first, then parent libraries). */
  libraries: LibrarySource[];
  rules: Rule[];
  guidance: GuidanceRule[];
  /** Basic rules switched off, with the stated reason (shown in reports). */
  disabled: Array<{ id: string; reason: string }>;
  /** Overrides for page-level visual rules (visual/*): a different level, or off with a reason. */
  visual: Array<{ id: string; level: RuleLevel; reason?: string }>;
  source?: string;
}
