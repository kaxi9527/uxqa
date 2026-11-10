import type { LibraryDiscovery } from '../library/types.js';

export interface Observation {
  id: string;
  route: string;
  url: string;
  state: string;
  viewport: string;
  family: string;
  selector: string;
  structure: string;
  styles: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
  screenshot?: string;
}

export interface ComponentCandidate {
  id: string;
  name: string;
  family: string;
  viewport: string;
  routes: string[];
  occurrences: number;
  reason: string;
  differences: Record<string, string[]>;
  suggestedProps: string[];
  requiresHumanReview: true;
  instances: Observation[];
}

export interface ToolRun {
  name: string;
  version: string;
  status: 'complete' | 'partial' | 'failed' | 'skipped';
  artifact?: string;
  error?: string;
}

export interface SourceLocation { file: string; line: number }
export interface CodeClone {
  kind: string;
  lines: number;
  first: SourceLocation;
  second: SourceLocation;
}
export interface ComponentUsage {
  name: string;
  module: string;
  count: number;
  props: string[];
  locations: SourceLocation[];
  fileCount: number;
  spreadInstances: number;
  propPatterns: PropPattern[];
  aliases: string[];
  exportName: string;
}
export interface PropPattern {
  prop:string; supplied:number; missing:number; spreadUnknown:number; dynamic:number;
  values:Array<{kind:string;value:unknown;count:number}>;
}
export interface ImportConflict {name:string;modules:string[];locations:SourceLocation[]}
export interface ReuseSummary {componentCount:number;sharedComponents:number;singleFileComponents:number;instances:number}
export interface CssSummary {
  bytes:number;selectors:number;declarations:number;uniqueColors:number;uniqueFontFamilies:number;
  uniqueFontSizes:number;uniqueBorderRadii:number;definedTokens:number;usedTokens:number;
  unknownTokens:string[];unusedTokens:string[];tokenDefinitionRatio:number;complexity:number;spacingValues:string[];
}
export interface CssAnalysis {label:string;summary:CssSummary;metrics:object}
export interface CssAudit {status:'complete'|'partial';analyses:CssAnalysis[];gaps:string[];artifact?:string}
export interface SourceAudit {
  status: 'complete' | 'partial';
  root: string;
  files: string[];
  duplicates: CodeClone[];
  components: ComponentUsage[];
  tools: ToolRun[];
  reuse: ReuseSummary;
  importConflicts: ImportConflict[];
  css: CssAudit;
}

export interface ComponentAudit {
  name: string;
  startedAt: string;
  endedAt: string;
  status: 'complete' | 'partial';
  coverage: Array<{ route: string; viewport: string; state: string; status: 'complete' | 'failed'; error?: string }>;
  observations: Observation[];
  candidates: ComponentCandidate[];
  tools: ToolRun[];
  source?: SourceAudit;
  css: Array<{route:string;viewport:string;audit:CssAudit}>;
  limitations: string[];
  library?: LibraryDiscovery;
}
