// Runs uxqa's own page checks against the uxqa console: the product must pass its own inspection.
// Usage: UXQA_UI_TOKEN=... node scripts/dogfood.mjs http://127.0.0.1:4870 <projectId> [outDir]
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { auditVisual } from '../dist/src/visual/audit.js';
import { runAudit } from '../dist/src/runner.js';
import { loadConfig } from '../dist/src/config.js';
import { startConsole } from '../dist/src/ui/server.js';

const [base = 'http://127.0.0.1:4870', projectId] = process.argv.slice(2);
const token = process.env.UXQA_UI_TOKEN;
if (!token || !projectId) { console.error('Need UXQA_UI_TOKEN and a project id'); process.exit(2); }
const out = process.argv[4] ?? await mkdtemp(join(tmpdir(), 'uxqa-dogfood-'));
const views = [
  ...['issues', 'components', 'rules', 'settings'].map((tab) => `/?project=${projectId}${tab === 'issues' ? '' : `&tab=${tab}`}`),
  ...['add', 'prompt', 'notes', 'changes', 'reuse'].map((panel) => `/?project=${projectId}&open=${panel}`),
  '/?settings=1',
];
const routes = views.map((view) => `${view}#t=${token}`);

// The welcome page only shows with no projects, so it is checked on a second, empty console.
process.env.UXQA_HOME = await mkdtemp(join(tmpdir(), 'uxqa-dogfood-home-'));
const empty = await startConsole({ port: 0 });
const welcome = [`/#t=${token}`, `/?open=add#t=${token}`];

let problems = 0;
for (const [name, baseUrl, list] of [['console', base, routes], ['welcome', `http://127.0.0.1:${empty.port}`, welcome]]) {
  const visual = await auditVisual({ baseUrl, routes: list, productRoot: resolve('.') }, join(out, 'visual', name));
  problems += visual.violations.length;
  console.log(`visual (${name}): ${visual.checkedPages} views checked, ${visual.violations.length} problems`);
  for (const violation of visual.violations) console.log(`  [${violation.level}] ${violation.name} — ${violation.detail}`);
}

const config = loadConfig({ name: 'uxqa console', baseUrl: base, routes, viewports: [{ name: 'desktop', width: 1440, height: 900 }, { name: 'narrow', width: 390, height: 844 }], options: { trace: 'off' } });
const run = await runAudit(config, { outDir: join(out, 'run') });
await empty.close();
const failed = run.checks.filter((check) => check.status === 'fail');
console.log(`run: ${run.checks.length} checks, ${failed.length} failed`);
for (const check of failed) console.log(`  [fail] ${check.check} ${check.route.replace(/#t=.*/, '')} ${check.viewport}: ${check.detail}`);
for (const finding of run.findings.filter((entry) => entry.severity === 'blocking')) console.log(`  [blocking] ${finding.kind} ${finding.route.replace(/#t=.*/, '')} ${finding.viewport}: ${finding.message} ${(finding.evidence ?? []).slice(0, 3).join(' | ')}`);
console.log(`evidence: ${out}`);
process.exitCode = problems || failed.length ? 1 : 0;
