export type Color = [number, number, number, number];
export interface FigmaConfig {
  fileKey: string;
  pageId: string;
  themes: { name: string; background: Color; backgroundVariableId?: string }[];
  forbiddenFonts?: string[];
  allowedColorPrefixes?: string[];
  tokenExpectations?: { id: string; theme: string; expected: Color }[];
}
export interface CaptureMeta {
  schemaVersion: 1;
  exportId: string;
  fileKey: string;
  pageId: string;
  capturedAt: string;
}
export interface FigmaIndex extends CaptureMeta {
  kind: 'index';
  pageName: string;
  componentIds: string[];
  themes: string[];
  forbiddenFonts?: string[];
  allowedColorPrefixes?: string[];
  tokenObservations?: { id: string; theme: string; expected: Color; actual: Color | null }[];
}
export interface TextSample {
  id: string;
  text: string;
  foreground: Color | null;
  background: Color | null;
  fontSize: number | null;
  bold: boolean | null;
  clipped: boolean;
  disabled: boolean;
}
export interface BoundarySample {
  id: string;
  color: Color | null;
  inside: Color | null;
  outside: Color | null;
  weight: number | null;
  align: string;
  variables: string[];
}
export interface ThemeSample {
  theme: string;
  appearance: string | null;
  texts: TextSample[];
  boundary: BoundarySample | null;
  unknown: string[];
}
export interface FigmaComponent {
  id: string;
  name: string;
  setId: string | null;
  setName: string;
  properties: Record<string, string>;
  width: number;
  height: number;
  disabled: boolean;
  icons: string[];
  hitRegions: { id: string; x: number; y: number; width: number; height: number; opacity: number }[];
  themes: ThemeSample[];
  structure?: { signature: string; nodes: number; types: Record<string, number> };
  dependencies?: { id: string; name: string; count: number }[];
  fonts?: string[];
  paintBindings?: { id: string; name: string; count: number }[];
  unboundPaints?: number;
}
export interface FigmaChunk extends CaptureMeta {
  kind: 'components';
  components: FigmaComponent[];
}
export type CheckStatus = 'pass' | 'fail' | 'review' | 'not-verified' | 'excluded';
export interface FigmaCheck {
  rule: string;
  status: CheckStatus;
  nodeId: string;
  component: string;
  theme?: string;
  message: string;
  observed?: number;
  threshold?: number;
}
export interface FigmaReport {
  schemaVersion: 1;
  source: CaptureMeta & { pageName: string; inputHashes: Record<string, string>; captureEnd: string };
  status: 'complete' | 'partial';
  verdict: 'issues-found' | 'needs-review' | 'limited-pass';
  coverage: { expectedComponents: number; capturedComponents: number; missingIds: string[]; themes: string[] };
  summary: Record<CheckStatus, number>;
  checks: FigmaCheck[];
  limitations: string[];
  catalog: { id: string; name: string; variants: number; componentIds: string[]; dependencies: string[]; fonts: string[] }[];
  mergeCandidates: { sets: string[]; names: string[]; reason: string; requiresSemanticReview: true }[];
}
