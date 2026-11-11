import { expect, it } from 'vitest';
import { GUIDES } from '../src/guidance/guides.js';
import { ENGLISH_GUIDES, localizedGuide } from '../src/guidance/guides.en.js';
import { ENGLISH_DIAGNOSTIC_CASES, ENGLISH_FOCUS_TITLES } from '../src/guidance/diagnostics.en.js';
import { DIAGNOSTIC_CASES, DIAGNOSIS_FOCUSES } from '../src/guidance/diagnostics.js';
import { ENGLISH_STACK_CHECKS } from '../src/guidance/context.en.js';
import { STACK_KNOWLEDGE } from '../src/guidance/context.js';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck } from '../src/check/run.js';
import { updateAccessSettings } from '../src/ui/access.js';
import { startConsole } from '../src/ui/server.js';
import { addProject, getRound, saveRound } from '../src/ui/store.js';
import { ruleCatalog } from '../src/rules/catalog.js';
import { ENGLISH_RULES } from '../src/rules/catalog.en.js';
import { buildRuleSet } from '../src/rules/load.js';
import { HINT_RULES } from '../src/check/hints.js';
import { ENGLISH_HINTS } from '../src/check/hints.en.js';
import { VISUAL_RULES, type VisualKind } from '../src/visual/rules.js';
import { englishVisualFinding } from '../src/visual/english.js';

it('provides English text for every native guide without changing identifiers or project semantics', () => {
  expect(Object.keys(ENGLISH_GUIDES).sort()).toEqual(GUIDES.map((guide) => guide.id).sort());
  for (const guide of GUIDES) {
    const english = localizedGuide(guide, 'en');
    expect(english.id).toBe(guide.id);
    expect(english.domain).toBe(guide.domain);
    expect(english.modes).toEqual(guide.modes);
    expect(english.checks).toHaveLength(guide.checks.length);
    expect([english.title, english.summary, ...english.checks, english.fix, english.verify].join(' ')).not.toMatch(/[\u4e00-\u9fff]/);
    expect(localizedGuide(guide, 'zh')).toBe(guide);
  }
});

it('covers all built-in diagnosis scenarios, focus titles, and stack checks in English', () => {
  expect(Object.keys(ENGLISH_DIAGNOSTIC_CASES).sort()).toEqual(Object.keys(DIAGNOSTIC_CASES).sort());
  expect(Object.keys(ENGLISH_FOCUS_TITLES).sort()).toEqual(DIAGNOSIS_FOCUSES.map((item) => item.id).sort());
  expect(Object.keys(ENGLISH_STACK_CHECKS).sort()).toEqual(STACK_KNOWLEDGE.map((item) => item.id).sort());
  for (const [key, checks] of Object.entries(ENGLISH_DIAGNOSTIC_CASES)) {
    expect(checks).toHaveLength(DIAGNOSTIC_CASES[key].length);
    expect(checks.join(' ')).not.toMatch(/[\u4e00-\u9fff]/);
  }
  for (const checks of Object.values(ENGLISH_STACK_CHECKS)) expect(checks.join(' ')).not.toMatch(/[\u4e00-\u9fff]/);
});

it('provides English descriptions for every built-in rule', () => {
  const rules = ruleCatalog(buildRuleSet(undefined));
  expect(rules.map((rule) => rule.id).sort()).toEqual(Object.keys(ENGLISH_RULES).sort());
  for (const [rule, why] of Object.values(ENGLISH_RULES)) expect(`${rule} ${why}`).not.toMatch(/[\u4e00-\u9fff]/);
  expect(Object.keys(ENGLISH_HINTS).sort()).toEqual(Object.keys(HINT_RULES).sort());
  for (const kind of Object.keys(VISUAL_RULES) as VisualKind[]) {
    const finding = englishVisualFinding(kind, { text: 'Example', detail: '10' }, [390]);
    expect(`${finding.name} ${finding.what} ${finding.consequence} ${finding.fix}`).not.toMatch(/[\u4e00-\u9fff]/);
    expect(finding.what).toContain('390px');
  }
});

it('serves English guidance without rewriting the recorded round or project observations', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-guides-en-home-'));
  const project = await mkdtemp(join(tmpdir(), 'uxqa-guides-en-project-'));
  const prior = process.env.UXQA_HOME;
  process.env.UXQA_HOME = home;
  await mkdir(join(project, 'src'));
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'fixture' }));
  await writeFile(join(project, 'src', 'Screen.tsx'), 'export const Screen = () => <button style={{ color: "#ef0101" }}>Submit</button>;');
  const entry = await addProject(project, 'English fixture');
  const round = await saveRound(entry.id, await runCheck({ source: project }));
  const original = JSON.stringify(await getRound(entry.id, round.id));
  await updateAccessSettings({ locale: 'en', onboardingDone: true });
  const server = await startConsole({ port: 0 });
  const url = new URL(server.url), token = new URLSearchParams(url.hash.slice(1)).get('t')!;
  const get = async (path: string) => (await fetch(`${url.origin}/api${path}`, { headers: { 'x-uxqa-token': token } })).json();
  try {
    const quality = await get('/quality');
    expect(quality.procedures).toHaveLength(GUIDES.length);
    expect(quality.procedures.find((item: { id: string }) => item.id === 'color').title).toBe('Color, themes, and contrast');
    const result = await get(`/projects/${entry.id}/rounds/${round.id}`);
    expect(result.round.result.violations.length).toBeGreaterThan(0);
    expect(result.round.result.violations[0].quality.guide.verify).not.toMatch(/[\u4e00-\u9fff]/);
    const color = result.round.result.violations.find((item: { rule: string }) => item.rule === 'basic/no-hardcoded-color');
    expect(color).toMatchObject({ title: 'Hard-coded color', fingerprint: round.result.violations.find((item) => item.rule === 'basic/no-hardcoded-color')?.fingerprint });
    expect(result.prompt).toMatch(/hard-coded color/i);
    expect(result.prompt).not.toMatch(/[\u4e00-\u9fff]/);
    const invalidPath = await fetch(`${url.origin}/api/access/check`, { method: 'POST', headers: { 'x-uxqa-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ path: 'relative' }) });
    expect(await invalidPath.json()).toMatchObject({ error: 'Enter an absolute path to the folder to check.' });
    const response = await fetch(`${url.origin}/api/projects/${entry.id}/diagnosis`, { method: 'POST', headers: { 'x-uxqa-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ focus: 'motion', roundId: round.id }) });
    expect(response.ok).toBe(true);
    const { plan } = await response.json();
    expect(plan.language).toBe('en');
    expect(plan.title).toBe('Motion and continuous interaction');
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks.map((task: { check: string }) => task.check).join(' ')).not.toMatch(/[\u4e00-\u9fff]/);
    expect(plan.markdown).toContain('not yet performed');
    expect(plan.markdown).toContain('preserved in their recorded language');
    expect(JSON.stringify(await getRound(entry.id, round.id))).toBe(original);
  } finally {
    await server.close();
    if (prior === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = prior;
    await rm(home, { recursive: true, force: true }); await rm(project, { recursive: true, force: true });
  }
}, 30_000);
