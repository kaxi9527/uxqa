import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, join, relative, resolve, sep } from 'node:path';
import { formatPrompt, formatSinglePrompt } from '../check/format.js';
import { formatEnglishPrompt } from '../check/format.en.js';
import { describeVariants, importHint } from '../check/messages.js';
import { runCheck } from '../check/run.js';
import { writeBaseline } from '../check/baseline.js';
import { findComponents } from '../inventory/find.js';
import { componentByName, findProductRoot, libraryLabel, readInventory } from '../inventory/read.js';
import { pullGitLibrary, validateSources } from '../inventory/sources.js';
import { ruleCatalog } from '../rules/catalog.js';
import { ENGLISH_RULES } from '../rules/catalog.en.js';
import { findPreview } from './preview.js';
import { BASIC_RULES, buildRuleSet, readRuleFile, RuleConfigError, validateAgainstInventory } from '../rules/load.js';
import { ASSETS } from './assets.js';
import { defaultScanRoot, discoverProjects } from './discover.js';
import { homedir } from 'node:os';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { AI_PRESETS, AiError, askVision, listModels, modelBase, publicAi, readAiSettings, writeAiSettings, type AiSettings, type AiProtocol } from '../ai/model.js';
import { engineStatus, engineRequest, stopEngine, EngineRequestError } from '../ai/engine.js';
import { reviewContext, reviewRound, runRound } from './round-runner.js';
import { reviewTasks } from '../ai/review.js';
import { browserInfo, browserReady, installBrowser, installState, MISSING_SENTENCE, type BrowserKind } from '../browser/install.js';
import { deflateSync, crc32 } from 'node:zlib';
import { GUIDES, DOMAIN_LABELS } from '../guidance/catalog.js';
import { localizedGuide } from '../guidance/guides.en.js';
import { DIAGNOSIS_FOCUSES, DIAGNOSTIC_CASES, KNOWLEDGE_VERSION } from '../guidance/diagnostics.js';
import { ENGLISH_FOCUS_TITLES } from '../guidance/diagnostics.en.js';
import { STACK_KNOWLEDGE } from '../guidance/context.js';
import { createDiagnosis, listDiagnoses } from './diagnosis.js';
import { getDiagnosisVerification, recordDiagnosisVerification, VerificationError } from './diagnosis-verification.js';
import { forgetAccessCheck, readAccessSettings, recordAccessCheck, recheckPreviouslyAccessible, updateAccessSettings } from './access.js';
import { availableRoundScreenshots, cleanExpiredScreenshots, expiredScreenshotNames } from './screenshot-retention.js';
import { englishUiError } from './errors.en.js';
import { issueGuidance } from '../guidance/issues.js';
import type { IssueDomain } from '../guidance/types.js';
import { readIssueWorkflow, setIssueDisposition, addObservation, recheckComparison, roundForWorkflow, ISSUE_STATES, type IssueState } from './issue-workflow.js';
import { addProject, dataDir, getRound, listProjects, listRounds, newRoundId, removeProject, saveRound, shotsDir, updateProject, type PageSettings, type ProjectEntry, type Round } from './store.js';

/** Coding AIs do noticeably better on a short list; the console suggests fixing this many first. */
const FIRST_BATCH = 10;

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

function issueDomain(value: unknown): IssueDomain | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'ui' || value === 'ux' || value === 'experience') return value;
  throw new HttpError(400, '问题分类只能是 UI、UX 或体验');
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, '请求内容太大');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, '请求内容不是有效的 JSON'); }
}

async function accessBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const input = await body(request);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '请求内容必须是对象');
  return input;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function project(id: string): Promise<ProjectEntry> {
  const entry = (await listProjects()).find((candidate) => candidate.id === id);
  if (!entry) throw new HttpError(404, '找不到这个项目，可能已被移除');
  return entry;
}

async function directory(path: unknown): Promise<string> {
  if (typeof path !== 'string' || !path.trim()) throw new HttpError(400, '请填写项目目录的路径');
  const absolute = resolve(path.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
  let info;
  try { info = await stat(absolute); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw new HttpError(403, `无法访问此位置：${absolute}。请在系统隐私设置中检查文件与文件夹权限，然后重试。`);
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw new HttpError(503, `暂时无法读取此位置：${absolute}。请确认磁盘或网络卷可用后重试。`);
  }
  if (!info?.isDirectory()) throw new HttpError(400, `这个路径不是一个存在的文件夹：${absolute}`);
  return realpath(absolute);
}

async function summarizeLibrary(root: string) {
  const inventory = await readInventory(root);
  return {
    productRoot: inventory.productRoot,
    library: libraryLabel(inventory) ?? null,
    libraries: inventory.libraries.map(({ root: _root, ...rest }) => { void _root; return rest; }),
    overrides: inventory.overrides,
    source: inventory.source,
    components: inventory.components.filter((component) => !/Icon$/.test(component.name)).length,
    icons: inventory.components.filter((component) => /Icon$/.test(component.name)).length,
    tokens: inventory.tokens.length,
    issues: inventory.issues,
  };
}

async function excerpt(root: string, file: unknown, line: unknown): Promise<{ start: number; lines: string[] }> {
  if (typeof file !== 'string' || !file) throw new HttpError(400, '缺少文件');
  const target = await realpath(resolve(root, file)).catch(() => { throw new HttpError(404, '文件已不存在'); });
  const realRoot = await realpath(root);
  if (target !== realRoot && !target.startsWith(`${realRoot}${sep}`)) throw new HttpError(403, '只能查看项目里的文件');
  const info = await lstat(target);
  if (!info.isFile() || info.size > 512_000) throw new HttpError(400, '这个文件不能预览');
  const all = (await readFile(target, 'utf8')).split('\n');
  const at = Math.max(1, Number(line) || 1);
  const start = Math.max(1, at - 5);
  return { start, lines: all.slice(start - 1, Math.min(all.length, at + 5)) };
}

async function rulesView(root: string, locale: 'zh' | 'en' | null) {
  const productRoot = await findProductRoot(root);
  const file = await readRuleFile(productRoot);
  const ruleSet = buildRuleSet(file.raw, file.path);
  return {
    path: file.path ? relative(productRoot, file.path) : null,
    raw: file.raw ? JSON.stringify(file.raw, null, 2) : null,
    basic: BASIC_RULES.map((rule) => ({ id: rule.id, level: rule.level, fix: locale === 'en' ? ENGLISH_RULES[rule.id]?.[0] ?? rule.fix : rule.fix })),
    active: ruleSet.rules.map((rule) => ({ id: rule.id, type: rule.type, level: rule.level, origin: rule.origin, fix: rule.fix ?? null, scope: rule.include, exclude: rule.exclude })),
    disabled: ruleSet.disabled,
    guidance: ruleSet.guidance,
    catalog: ruleCatalog(ruleSet).map((entry) => locale === 'en' && ENGLISH_RULES[entry.id] ? { ...entry, rule: ENGLISH_RULES[entry.id][0], why: ENGLISH_RULES[entry.id][1] } : entry),
  };
}

async function validateRules(root: string, raw: unknown): Promise<{ text: string; parsed: Record<string, unknown> }> {
  if (typeof raw !== 'string') throw new HttpError(400, '缺少规则内容');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (error) {
    // Plain-language position instead of the parser's English message.
    const message = error instanceof Error ? error.message : '';
    const at = message.match(/line (\d+) column (\d+)/);
    throw new HttpError(400, at ? `规则内容的格式写错了：第 ${at[1]} 行第 ${at[2]} 个字附近，可能少了逗号、引号或括号。` : '规则内容的格式写错了，可能少了逗号、引号或括号。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, '规则文件的最外层必须是一个对象');
  try {
    const ruleSet = buildRuleSet(parsed as Record<string, unknown>);
    const problems = validateAgainstInventory(ruleSet, await readInventory(root, { ...(ruleSet.libraryRoot ? { root: ruleSet.libraryRoot } : {}), libraries: ruleSet.libraries }));
    if (problems.length) throw new HttpError(400, problems.join('\n'));
  } catch (error) {
    if (error instanceof RuleConfigError) throw new HttpError(400, error.message);
    throw error;
  }
  return { text: `${JSON.stringify(parsed, null, 2)}\n`, parsed: parsed as Record<string, unknown> };
}


interface Job {
  id: string;
  projectId: string;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  phase: 'source' | 'pages' | 'ai' | 'saving';
  message: string;
  done: number;
  total: number;
  roundId?: string;
  error?: string;
  errorCode?: string;
  errorPath?: string;
  controller: AbortController;
}

const jobs = new Map<string, Job>();
let screenshotRetentionStatus: { checkedAt: string | null; removed: number; error: string | null } = { checkedAt: null, removed: 0, error: null };

/** Browser windows opened for the person to log in to their own product; the login state is saved locally on their request. */
const logins = new Map<string, { browser: Browser; context: BrowserContext }>();

async function closeLogin(id: string): Promise<void> {
  const login = logins.get(id);
  logins.delete(id);
  await login?.browser.close().catch(() => undefined);
}


function publicJob(job: Job) {
  const { controller: _controller, ...rest } = job;
  void _controller;
  return rest;
}

async function runJob(job: Job, entry: ProjectEntry, skipPages = false): Promise<void> {
  try {
    const round = await runRound(entry, {
      skipPages,
      signal: job.controller.signal,
      progress: (step) => { job.phase = step.phase; job.message = step.message; if (step.done !== undefined) job.done = step.done; if (step.total !== undefined) job.total = step.total; },
    });
    job.roundId = round.id;
    job.state = job.controller.signal.aborted ? 'cancelled' : 'done';
    job.message = '检测完成';
  } catch (error) {
    job.state = 'failed';
    const failure = error as NodeJS.ErrnoException;
    job.errorCode = failure?.code;
    job.errorPath = failure?.path;
    job.error = failure?.code === 'EACCES' || failure?.code === 'EPERM'
      ? `无法读取${failure.path ? ` ${failure.path}` : '项目文件'}。请检查文件与文件夹权限后重试。`
      : error instanceof Error ? error.message : String(error);
  }
}

/** Screenshot review on an existing round, with the configured vision model. */
async function runReviewJob(job: Job, entry: ProjectEntry, round: Round): Promise<void> {
  try {
    const settings = await readAiSettings();
    const outcome = await reviewRound(entry, round, settings, {
      signal: job.controller.signal,
      progress: (step) => { job.phase = step.phase; job.message = step.message; if (step.done !== undefined) job.done = step.done; if (step.total !== undefined) job.total = step.total; },
    });
    job.roundId = round.id;
    job.state = 'done';
    job.message = outcome.errors.length && !outcome.verified && !outcome.found ? `AI 复核没有完成：${outcome.errors[0]}` : `AI 复核完成：看了 ${outcome.verified} 个问题，新发现 ${outcome.found} 个`;
  } catch (error) {
    job.state = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
  }
}

/** A small solid PNG for "test connection"; some providers refuse tiny images. */
function testImage(): Buffer {
  const size = 64;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([31, 95, 79]))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function parseAi(input: Record<string, unknown>, current: AiSettings): Promise<AiSettings> {
  const mode = input.mode === 'api' || input.mode === 'agent' ? input.mode : 'off';
  const protocol: AiProtocol = ['openai', 'responses', 'anthropic', 'gemini'].includes(String(input.protocol)) ? input.protocol as AiProtocol : current.protocol;
  const connection = input.connection === 'native' || input.connection === 'magpie' ? 'native' : input.connection === 'direct' ? 'direct' : current.connection === 'magpie' ? 'native' : current.connection ?? 'direct';
  let baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim().replace(/\/+$/, '') : current.baseUrl;
  if (baseUrl && !/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;
  if (baseUrl) { try { new URL(baseUrl); } catch { throw new HttpError(400, '模型地址看不懂，例如 https://api.openai.com/v1'); } }
  const model = typeof input.model === 'string' ? input.model.trim() : current.model;
  // An empty key field means "keep the saved key"; clearKey removes it.
  const changedEndpoint = baseUrl !== current.baseUrl || protocol !== current.protocol || connection !== (current.connection ?? 'direct');
  const apiKey = input.clearKey === true || connection === 'native' ? undefined : typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : changedEndpoint ? undefined : current.apiKey;
  const number = (value: unknown, fallback: number, min: number, max: number) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback; };
  const settings: AiSettings = {
    mode, connection, protocol, baseUrl: connection === 'native' ? '' : baseUrl, model,
    passes: number(input.passes, current.passes, 1, 3),
    verify: input.verify === undefined ? current.verify : input.verify === true,
    discover: input.discover === undefined ? current.discover : input.discover === true,
    maxCalls: number(input.maxCalls, current.maxCalls, 1, 500),
    ...(apiKey ? { apiKey } : {}),
  };
  if (mode === 'api' && (!model || (connection === 'direct' && !baseUrl))) throw new HttpError(400, '请填写模型名；直接连接还需要模型地址');
  if (connection === 'direct' && baseUrl) modelBase(settings);
  return settings;
}

function clientRound(round: Round, locale: 'zh' | 'en' | null) {
  // Screenshots are referred to by file name only; the browser fetches them through /shot.
  const captures: Record<string, unknown> = {};
  for (const [key, capture] of Object.entries(round.capture?.captures ?? {})) {
    const englishNotes: Record<string, string> = {
      'login-required': 'The relevant page requires a saved login state.',
      'preview-down': 'The preview could not be opened. Check that the preview server is running and the URL is correct.',
      'file-not-opened': 'No page that uses this file was opened in this round.',
      hidden: 'The element could not be located on the opened pages.',
      'code-only': 'This finding could not be located on the page.',
    };
    const note = capture.shots.length ? `Screenshot captured; ${capture.matches} matching element${capture.matches === 1 ? '' : 's'} found. Confirm the location on the page.` : englishNotes[capture.reason ?? ''] ?? 'No screenshot was saved for this finding.';
    captures[key] = { ...capture, ...(locale === 'en' ? { originalNote: capture.note, note } : {}), shots: capture.shots.map((shot) => ({ ...shot, ...(locale === 'en' ? { viewport: shot.viewport.replace(/\s*宽$/, 'px wide') } : {}), crop: basename(shot.crop), full: basename(shot.full) })) };
  }
  return {
    ...round,
    ...(round.partial === MISSING_SENTENCE ? { partialCode: 'browser-missing' } : {}),
    ...(locale === 'en' && round.partial === MISSING_SENTENCE ? { partial: 'No screenshots this round: the browser component is not installed. Source checks completed; start another check and confirm the download, or run uxqa browser install.' } : {}),
    result: { ...round.result, violations: round.result.violations.map((violation) => {
      const quality = issueGuidance(violation);
      if (locale === 'en') return { ...violation, ...(violation.english ?? {}), ...(violation.rule.startsWith('visual/') && violation.file.startsWith('页面 ') ? { file: `Page ${violation.file.slice(3)}` } : {}), ...(violation.origin === 'manual' ? { title: 'Manual observation', consequence: 'This is a manual observation; reproduce and verify the reported behavior.', ...(violation.fix === '先按记录的操作重现，再根据项目规范修复并复检。' ? { fix: 'Reproduce the recorded steps, then fix and recheck according to project rules.' } : {}) } : {}), quality: { ...quality, guide: localizedGuide(quality.guide, locale),
        label: { ui: 'UI · visual design', ux: 'UX · tasks and interaction', experience: 'Experience · feedback and motion' }[quality.domain],
        evidence: violation.origin === 'manual' ? 'Manual observation; not automatically verified' : violation.origin === 'ai' ? 'AI screenshot suggestion' : violation.rule.startsWith('visual/') ? 'Page check' : 'Source check',
        basis: violation.domain ? 'Reported category' : 'Reference category based on the rule' } };
      return { ...violation, quality };
    }) },
    capture: round.capture ? { ...round.capture, captures, views: (round.capture.views ?? []).map((view) => ({ ...view, image: basename(view.image) })), changes: (round.capture.changes ?? []).map((change) => ({ ...change, image: basename(change.image), previousImage: basename(change.previousImage), ...(change.diff ? { diff: basename(change.diff) } : {}) })), pages: round.capture.pages.map((page) => ({ ...page, screenshot: page.screenshot ? basename(page.screenshot) : undefined })) } : undefined,
  };
}

async function parseSettings(input: Record<string, unknown>): Promise<PageSettings | undefined> {
  let baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
  if (!baseUrl) return undefined;
  // People usually type `localhost:5173`; add the missing scheme instead of refusing it.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl.replace(/^\/+/, '')}`;
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new HttpError(400, '这个预览地址看不懂，例如可以写 localhost:5173 或 http://localhost:5173'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new HttpError(400, '页面地址只能是 http 或 https 开头');
  if (parsed.username || parsed.password) throw new HttpError(400, '页面地址里不要写账号密码；需要登录时请提供登录状态文件');
  const routes = (Array.isArray(input.routes) ? input.routes : String(input.routes ?? '').split(/\n|,/)).map((route) => String(route).trim()).filter(Boolean);
  for (const route of routes) if (!route.startsWith('/')) throw new HttpError(400, `页面路径要以 / 开头：${route}`);
  let storageState: string | undefined;
  if (typeof input.storageState === 'string' && input.storageState.trim()) {
    storageState = resolve(input.storageState.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    if (!(await stat(storageState).then((info) => info.isFile(), () => false))) throw new HttpError(400, `找不到登录状态文件：${storageState}`);
  }
  return { baseUrl: parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')), routes: routes.length ? routes : ['/'], discover: input.discover === true, ...(storageState ? { storageState } : {}) };
}

async function route(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  const method = request.method ?? 'GET';
  const parts = path.split('/').filter(Boolean).slice(1); // after "api"
  if (parts[0] === 'access' && method === 'GET' && parts.length === 1) return send(response, 200, { ...(await readAccessSettings()), dataLocation: dataDir().replace(homedir(), '~') });
  if (parts[0] === 'access' && method === 'POST' && parts[1] === 'check' && parts.length === 2) {
    const input = await accessBody(request);
    if (typeof input.path !== 'string' || !input.path.trim()) throw new HttpError(400, '请填写要检查的文件夹绝对路径');
    try { return send(response, 200, await recordAccessCheck(input.path)); }
    catch (error) { if (error instanceof Error && error.message === 'INVALID_PATH') throw new HttpError(400, '请填写要检查的文件夹绝对路径'); throw error; }
  }
  if (parts[0] === 'screenshot-retention' && method === 'GET' && parts.length === 1) return send(response, 200, screenshotRetentionStatus);
  if (parts[0] === 'access' && method === 'POST' && parts[1] === 'recheck' && parts.length === 2) return send(response, 200, await recheckPreviouslyAccessible());
  if (parts[0] === 'access' && method === 'POST' && parts[1] === 'forget' && parts.length === 2) {
    const input = await accessBody(request);
    if (typeof input.path !== 'string' || !input.path) throw new HttpError(400, '请选择要移除的访问记录');
    return send(response, 200, await forgetAccessCheck(input.path));
  }
  if (parts[0] === 'access' && method === 'POST' && parts.length === 1) {
    const input = await accessBody(request);
    if (input.locale !== undefined && input.locale !== 'zh' && input.locale !== 'en') throw new HttpError(400, '请选择中文或 English');
    if (input.onboardingDone !== undefined && typeof input.onboardingDone !== 'boolean') throw new HttpError(400, '无效的引导状态');
    return send(response, 200, await updateAccessSettings({ ...(input.locale !== undefined ? { locale: input.locale as 'zh' | 'en' } : {}), ...(input.onboardingDone !== undefined ? { onboardingDone: input.onboardingDone as boolean } : {}) }));
  }
  if (method === 'GET' && parts[0] === 'quality') {
    const locale = (await readAccessSettings()).locale;
    return send(response, 200, { domains: locale === 'en' ? { ui: 'UI · visual design', ux: 'UX · tasks and interaction', experience: 'Experience · feedback and motion' } : DOMAIN_LABELS, procedures: GUIDES.map((guide) => { const { keywords, ...procedure } = localizedGuide(guide, locale); void keywords; return procedure; }), focuses: DIAGNOSIS_FOCUSES.map((focus) => locale === 'en' ? { ...focus, title: ENGLISH_FOCUS_TITLES[focus.id] } : focus), knowledgeVersion: KNOWLEDGE_VERSION, scenarioChecks: Object.values(DIAGNOSTIC_CASES).flat().length, stackFamilies: STACK_KNOWLEDGE.length });
  }
  if (method === 'GET' && parts[0] === 'projects' && parts.length === 1) {
    const projects = await listProjects();
    const withRounds = await Promise.all(projects.map(async (entry) => ({ ...entry, lastRound: (await listRounds(entry.id))[0] ?? null })));
    return send(response, 200, { projects: withRounds });
  }
  if (method === 'POST' && parts[0] === 'projects' && parts.length === 1) {
    const input = await body(request);
    let selected: string;
    try { selected = await directory(input.path); }
    catch (error) {
      if (error instanceof HttpError && error.status === 403 && typeof input.path === 'string') await recordAccessCheck(input.path).catch(() => undefined);
      throw error;
    }
    const selectedAccess = await recordAccessCheck(selected);
    const selectedCheck = selectedAccess.checks.find((item) => item.path === selected);
    if (selectedCheck && selectedCheck.result !== 'accessible') throw new HttpError(403, `无法读取项目位置：${selected}。请在系统隐私设置中检查文件与文件夹权限，并确认位置可用。`);
    const root = await findProductRoot(selected);
    const library = await summarizeLibrary(root);
    const accessState = root === selected ? selectedAccess : await recordAccessCheck(root);
    const access = accessState.checks.find((item) => item.path === root);
    if (access && access.result !== 'accessible') throw new HttpError(403, `无法读取项目位置：${root}。请在系统隐私设置中检查文件与文件夹权限，并确认位置可用。`);
    const entry = await addProject(root, typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined);
    return send(response, 200, { project: entry, library });
  }
  // The exact command that starts this uxqa's MCP server, so agents can be connected before uxqa is packaged.
  // The screenshot browser is downloaded only after the person agreed to the files, source and size shown first.
  if (parts[0] === 'browser' && parts.length === 1 && method === 'GET') {
    const kind: BrowserKind = new URL(request.url ?? '/', 'http://localhost').searchParams.get('kind') === 'chromium' ? 'chromium' : 'shell';
    return send(response, 200, { browser: await browserInfo(kind), install: installState() ?? null });
  }
  if (parts[0] === 'browser' && parts[1] === 'install' && method === 'GET') return send(response, 200, { install: installState() ?? null });
  if (parts[0] === 'browser' && parts[1] === 'install' && method === 'POST') {
    const input = await body(request);
    if (input.confirm !== true) throw new HttpError(400, '下载浏览器组件需要你先确认');
    const kind: BrowserKind = input.kind === 'chromium' ? 'chromium' : 'shell';
    if (installState()?.state === 'running') return send(response, 409, { error: '浏览器组件正在下载中', install: installState() });
    if (await browserReady(kind)) return send(response, 200, { install: { kind, state: 'done', percent: 100, message: '浏览器组件已经在这台电脑上了' } });
    void installBrowser(kind);
    return send(response, 202, { install: installState() });
  }
  if (parts[0] === 'ai' && parts.length === 1 && method === 'GET') return send(response, 200, { settings: publicAi(await readAiSettings()), presets: AI_PRESETS, mcp: { command: process.execPath, args: (process.env.UXQA_CLI_ENTRY ?? process.argv[1]) ? [process.env.UXQA_CLI_ENTRY ?? process.argv[1]] : [] }, home: dataDir().replace(homedir(), '~') });
  if (parts[0] === 'ai' && parts[1] === 'engine' && method === 'GET') return send(response, 200, await engineStatus());
  if (parts[0] === 'ai' && parts[1] === 'native') {
    const path = '/' + parts.slice(2).join('/');
    const readable = path === '/state' || /^\/login\/[a-zA-Z0-9_-]+$/.test(path);
    const writable = ['/providers', '/provider-delete', '/account', '/login'].includes(path) || /^\/login\/[a-zA-Z0-9_-]+$/.test(path);
    if ((method === 'GET' && readable) || (method === 'POST' && writable)) {
      return send(response, 200, await engineRequest(path, method === 'POST' ? await body(request) : undefined));
    }
    throw new HttpError(404, '模型操作不存在');
  }
  if (parts[0] === 'ai' && parts[1] === 'models' && method === 'POST') {
    const input = await body(request);
    const settings = await parseAi({ ...input, model: 'model-discovery', mode: 'api' }, await readAiSettings());
    if (settings.connection === 'native') return send(response, 200, await engineRequest('/models'));
    return send(response, 200, { models: await listModels(settings) });
  }
  if (parts[0] === 'ai' && parts.length === 1 && method === 'POST') {
    const settings = await parseAi(await body(request), await readAiSettings());
    await writeAiSettings(settings);
    return send(response, 200, { settings: publicAi(settings) });
  }
  if (parts[0] === 'ai' && parts[1] === 'test' && method === 'POST') {
    const settings = await parseAi({ ...(await body(request)), mode: 'api' }, await readAiSettings());
    const english = (await readAccessSettings()).locale === 'en';
    try {
      const answer = await askVision(settings, english ? 'This is a solid-color image. Reply only with the color name in English.' : '这是一张纯色小图。请只回答这个颜色的中文名称，不要别的文字。', [testImage()]);
      return send(response, 200, { ok: true, message: english ? `Connected. Model response: ${answer.trim().slice(0, 40) || '(empty)'}` : `连接成功，模型看图回答：${answer.trim().slice(0, 40) || '（空）'}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return send(response, 200, { ok: false, message: english ? `Connection failed: ${englishUiError(message)}` : error instanceof AiError ? message : `没连上：${message}` });
    }
  }
  if (method === 'POST' && parts[0] === 'discover') {
    const input = await body(request);
    const start = input.path ? await directory(input.path) : undefined;
    const added = new Map((await listProjects()).map((entry) => [entry.root, entry.id]));
    let candidates;
    try { candidates = (await discoverProjects(start)).map((candidate) => ({ ...candidate, added: added.has(candidate.root), ...(added.has(candidate.root) ? { id: added.get(candidate.root) } : {}) })); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') throw new HttpError(403, '无法读取所选文件夹。请检查系统文件与文件夹权限，然后重试。');
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new HttpError(404, '所选文件夹已不存在或已移动。');
      throw new HttpError(503, '暂时无法读取所选文件夹，请检查磁盘或网络卷。');
    }
    const folder = start ?? await defaultScanRoot();
    return send(response, 200, { candidates, folder: folder.replace(homedir(), '~') });
  }
  if (parts[0] !== 'projects' || !parts[1]) throw new HttpError(404, '没有这个接口');
  const entry = await project(parts[1]);
  const action = parts[2];

  if (action === 'diagnosis' && parts[3] && parts[4] === 'verification' && parts.length === 5) {
    try {
      if (method === 'GET') return send(response, 200, await getDiagnosisVerification(entry.id, parts[3]));
      if (method === 'POST') return send(response, 200, await recordDiagnosisVerification(entry.id, parts[3], await body(request), 'api'));
    } catch (error) { if (error instanceof VerificationError) throw new HttpError(error.status, error.message); throw error; }
  }
  if (method === 'GET' && action === 'diagnosis' && parts.length === 3) return send(response, 200, { plans: await listDiagnoses(entry.id) });
  if (method === 'POST' && action === 'diagnosis' && parts.length === 3) {
    const input = await body(request);
    const focus = DIAGNOSIS_FOCUSES.find((item) => item.id === input.focus);
    if (!focus) throw new HttpError(400, '请选择有效的专项诊断目标');
    const roundId = typeof input.roundId === 'string' ? input.roundId : (await listRounds(entry.id))[0]?.id;
    const round = roundId ? await getRound(entry.id, roundId) : undefined;
    if (!round) throw new HttpError(404, '请先完成一轮检查，再根据证据生成方案');
    const objective = typeof input.objective === 'string' ? input.objective.trim().slice(0, 500) : '';
    return send(response, 200, { plan: await createDiagnosis(entry, round, await readIssueWorkflow(entry.id), focus, objective) });
  }

  if (method === 'GET' && action === 'issue-workflow') return send(response, 200, { workflow: await readIssueWorkflow(entry.id), states: ISSUE_STATES });
  if (method === 'POST' && action === 'issue-workflow') {
    const input = await body(request);
    const roundId = typeof input.roundId === 'string' ? input.roundId : '';
    const round = roundId ? await getRound(entry.id, roundId) : undefined;
    const workflow = await readIssueWorkflow(entry.id);
    const fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint : '';
    if (![...(round?.result.violations ?? []), ...workflow.observations].some((issue) => issue.fingerprint === fingerprint)) throw new HttpError(404, '找不到要处理的问题');
    if (typeof input.state !== 'string' || !Object.hasOwn(ISSUE_STATES, input.state)) throw new HttpError(400, '请选择有效的处理状态');
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 2000) : '';
    if ((input.state === 'accepted' || input.state === 'confirmed') && !note) throw new HttpError(400, '接受偏差或人工确认时，请填写理由或验证证据');
    const domain = issueDomain(input.domain);
    return send(response, 200, { workflow: await setIssueDisposition(entry.id, fingerprint, { state: input.state as IssueState, note, roundId, ...(domain ? { domain } : {}) }) });
  }
  if (method === 'POST' && action === 'observations') {
    const input = await body(request);
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 100) : '';
    const detail = typeof input.detail === 'string' ? input.detail.trim().slice(0, 2000) : '';
    const location = typeof input.location === 'string' ? input.location.trim().slice(0, 300) : '';
    if (!name || !detail || !location) throw new HttpError(400, '请填写问题名称、位置，以及可重现的操作与观察证据');
    return send(response, 200, { workflow: await addObservation(entry.id, { name, detail, location, domain: issueDomain(input.domain) ?? 'experience', fix: typeof input.fix === 'string' ? input.fix.slice(0, 500) : '' }) });
  }
  if (method === 'GET' && action === 'recheck') {
    const rounds = await listRounds(entry.id);
    const selected = new URL(request.url ?? '/', 'http://localhost').searchParams.get('round') ?? rounds[0]?.id;
    const index = rounds.findIndex((item) => item.id === selected);
    if (index < 0) return send(response, 200, { comparison: null, workflow: await readIssueWorkflow(entry.id) });
    const current = await getRound(entry.id, rounds[index].id);
    const previous = rounds[index + 1] ? await getRound(entry.id, rounds[index + 1].id) : undefined;
    if (!current) throw new HttpError(404, '找不到这一轮检测');
    return send(response, 200, { comparison: recheckComparison(previous, current), workflow: await readIssueWorkflow(entry.id) });
  }

  if (method === 'DELETE' && !action) { await removeProject(entry.id); return send(response, 200, { removed: true }); }
  if (method === 'GET' && action === 'library') return send(response, 200, await summarizeLibrary(entry.root));
  if (method === 'GET' && action === 'components') {
    const inventory = await readInventory(entry.root);
    const query = new URL(request.url ?? '/', 'http://localhost').searchParams.get('q')?.trim();
    const list = query ? findComponents(inventory, query, 20).map((match) => match.component) : inventory.components.filter((component) => !/Icon$/.test(component.name));
    // One card per file: the main export stands for its parts (Tabs for TabsList, TabsTrigger…).
    const byFile = new Map<string, typeof list>();
    for (const component of list) byFile.set(component.file, [...(byFile.get(component.file) ?? []), component]);
    const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const cards = [...byFile.entries()].map(([file, members]) => {
      const stem = basename(file).replace(/\.[^.]+$/, '').toLowerCase();
      const main = members.find((component) => kebab(component.name) === stem) ?? [...members].sort((a, b) => a.name.length - b.name.length)[0];
      const parts = inventory.components.filter((component) => component.file === file && component !== main && !/Icon$/.test(component.name)).map((component) => component.name);
      const preferred = componentByName(inventory, main.name);
      return {
        name: main.name, label: main.label ?? null, file, importHint: importHint(main, inventory), variants: main.variants, defaults: main.defaults, variantText: describeVariants(main),
        parts, duplicateOf: preferred && preferred.file !== file ? preferred.file : null, source: main.library ?? null,
      };
    });
    return send(response, 200, { library: libraryLabel(inventory) ?? null, components: cards });
  }
  if (method === 'GET' && action === 'rounds' && !parts[3]) return send(response, 200, { rounds: await listRounds(entry.id) });
  if (method === 'GET' && action === 'rounds' && parts[3]) {
    const round = await getRound(entry.id, parts[3]);
    if (!round) throw new HttpError(404, '找不到这一轮检测');
    const workflow = await readIssueWorkflow(entry.id);
    const available = await availableRoundScreenshots(entry.id, round);
    const combined = roundForWorkflow(available, workflow).result;
    const locale = (await readAccessSettings()).locale;
    const prompts = Object.fromEntries(combined.violations.filter((violation) => violation.status === 'new').map((violation) => [violation.fingerprint, locale === 'en' ? formatEnglishPrompt(combined, { only: violation }) : formatSinglePrompt(combined, { ...violation, name: violation.name ?? violation.title })]));
    const { ruleText, pageRules } = await reviewContext(entry);
    const ai = await readAiSettings();
    const review = { mode: ai.mode, pending: available.capture ? reviewTasks(available, ruleText, pageRules).filter((task) => (task.kind === 'verify' ? ai.verify : ai.discover) || ai.mode !== 'api').length : 0 };
    return send(response, 200, { round: clientRound({ ...available, result: combined }, locale), prompt: locale === 'en' ? formatEnglishPrompt(combined) : formatPrompt(combined), promptFirst: locale === 'en' ? formatEnglishPrompt(combined, { limit: FIRST_BATCH }) : formatPrompt(combined, { limit: FIRST_BATCH }), prompts, review, workflow, issueStates: ISSUE_STATES });
  }
  if (method === 'POST' && action === 'check') {
    const running = [...jobs.values()].find((job) => job.projectId === entry.id && job.state === 'running');
    if (running) return send(response, 409, { error: '这个项目正在检测中，请等它完成或先取消', job: publicJob(running) });
    const checked = await recordAccessCheck(entry.root);
    const access = checked.checks.find((item) => item.path === entry.root);
    if (access && access.result !== 'accessible') throw new HttpError(403, `无法读取项目位置：${entry.root}。位置可能已移动、不可用或访问被拒绝；请在设置中检查访问状态。`);
    const skipPages = (await body(request)).skipPages === true;
    if (entry.pages?.baseUrl && !skipPages && !(await browserReady('shell').catch(() => true))) {
      return send(response, 409, { error: '给页面截图需要先下载浏览器组件', browser: await browserInfo('shell') });
    }
    const job: Job = { id: randomBytes(6).toString('hex'), projectId: entry.id, state: 'running', phase: 'source', message: '准备开始', done: 0, total: 0, controller: new AbortController() };
    jobs.set(job.id, job);
    void runJob(job, entry, skipPages);
    return send(response, 202, { job: publicJob(job) });
  }
  if (method === 'POST' && action === 'rounds' && parts[3] && parts[4] === 'ai-review') {
    const settings = await readAiSettings();
    if (settings.mode !== 'api') throw new HttpError(400, '还没有配置用 API 看图；在"页面"里的"AI 看图复核"设置');
    const round = await getRound(entry.id, parts[3]);
    if (!round) throw new HttpError(404, '找不到这一轮检测');
    const available = await availableRoundScreenshots(entry.id, round);
    if (available.capture?.screenshotsExpired && !reviewTasks(available, () => undefined, []).length) throw new HttpError(410, (await readAccessSettings()).locale === 'en' ? 'Screenshots expired after 48 hours. Run a new check before review.' : '截图已按 48 小时保留规则清理，请重新检测后复核。');
    const running = [...jobs.values()].find((job) => job.projectId === entry.id && job.state === 'running');
    if (running) return send(response, 409, { error: '这个项目正在检测中，请等它完成', job: publicJob(running) });
    const job: Job = { id: randomBytes(6).toString('hex'), projectId: entry.id, state: 'running', phase: 'ai', message: 'AI 准备看截图', done: 0, total: 0, controller: new AbortController() };
    jobs.set(job.id, job);
    void runReviewJob(job, entry, round);
    return send(response, 202, { job: publicJob(job) });
  }
  if (method === 'GET' && action === 'jobs' && parts[3]) {
    const job = jobs.get(parts[3]);
    if (!job || job.projectId !== entry.id) throw new HttpError(404, '找不到这次检测');
    return send(response, 200, { job: publicJob(job) });
  }
  if (method === 'POST' && action === 'jobs' && parts[3] && parts[4] === 'cancel') {
    const job = jobs.get(parts[3]);
    if (!job || job.projectId !== entry.id) throw new HttpError(404, '找不到这次检测');
    job.controller.abort();
    job.message = '正在取消，会保留已完成的部分';
    return send(response, 200, { job: publicJob(job) });
  }
  if (method === 'GET' && action === 'shot') {
    const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const round = query.get('round') ?? '';
    const name = query.get('name') ?? '';
    if (!/^[\w-]+$/.test(round) || !/^[\w.-]+\.png$/.test(name)) throw new HttpError(400, '截图名称不对');
    const file = join(shotsDir(entry.id, round), name);
    const data = await readFile(file).catch(async () => {
      if ((await expiredScreenshotNames(entry.id, round)).has(name)) throw new HttpError(410, (await readAccessSettings()).locale === 'en' ? 'The screenshot expired after 48 hours. Run a new check.' : '截图已按 48 小时保留规则清理，请重新检测。');
      throw new HttpError(404, '截图已不存在');
    });
    response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(data);
    return;
  }
  if (method === 'POST' && action === 'login' && parts[3] === 'start') {
    if (!entry.pages?.baseUrl) throw new HttpError(400, '请先填写并保存预览地址');
    const headless = process.env.UXQA_LOGIN_HEADLESS === '1';
    const kind: BrowserKind = headless ? 'shell' : 'chromium';
    if (!(await browserReady(kind).catch(() => true))) return send(response, 409, { error: '打开登录窗口需要先下载浏览器组件', browser: await browserInfo(kind) });
    await closeLogin(entry.id);
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    browser.on('disconnected', () => { logins.delete(entry.id); });
    logins.set(entry.id, { browser, context });
    await page.goto(new URL(entry.pages.routes[0] ?? '/', entry.pages.baseUrl).toString()).catch(() => undefined);
    return send(response, 200, { started: true });
  }
  if (method === 'POST' && action === 'login' && parts[3] === 'finish') {
    const login = logins.get(entry.id);
    if (!login) throw new HttpError(400, '登录窗口已经关掉了，请重新点"打开浏览器登录"');
    const directory = join(dataDir(), 'auth');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${entry.id}.json`);
    await login.context.storageState({ path: file });
    await import('node:fs/promises').then(({ chmod }) => chmod(file, 0o600));
    await closeLogin(entry.id);
    const updated = await updateProject(entry.id, { pages: { ...entry.pages!, storageState: file } });
    return send(response, 200, { saved: file, pages: updated.pages });
  }
  if (method === 'POST' && action === 'login' && parts[3] === 'cancel') {
    await closeLogin(entry.id);
    return send(response, 200, { cancelled: true });
  }
  if (method === 'GET' && action === 'settings') return send(response, 200, { pages: entry.pages ?? null });
  if (method === 'POST' && action === 'settings' && !parts[3]) {
    const pages = await parseSettings(await body(request));
    const updated = await updateProject(entry.id, { pages });
    return send(response, 200, { pages: updated.pages ?? null });
  }
  if (method === 'POST' && action === 'settings' && parts[3] === 'test') {
    const pages = await parseSettings(await body(request));
    if (!pages) throw new HttpError(400, '请先填写页面地址');
    const english = (await readAccessSettings()).locale === 'en';
    try {
      const reply = await fetch(new URL(pages.routes[0], pages.baseUrl), { signal: AbortSignal.timeout(5000), redirect: 'manual' });
      return send(response, 200, { ok: reply.status < 400, status: reply.status, message: english ? reply.status < 400 ? `Preview opened (status ${reply.status}).` : `Page returned ${reply.status}. Check the URL and path.` : reply.status < 400 ? `可以打开（状态 ${reply.status}）` : `页面返回 ${reply.status}，请确认地址和路径` });
    } catch (error) {
      const detail = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
      return send(response, 200, { ok: false, message: english ? `Could not open preview: ${detail}. Check that it is running.` : `打不开：${detail}。请确认预览已经在运行。` });
    }
  }
  if (method === 'GET' && action === 'excerpt') {
    const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
    return send(response, 200, await excerpt(entry.root, query.get('file'), query.get('line')));
  }
  // Library sources: try a list without saving it, and pull a git library on request.
  if (method === 'POST' && action === 'libraries' && parts[3] === 'preview') {
    const input = await body(request);
    const { sources, problems } = validateSources(input.libraries);
    if (problems.length) throw new HttpError(400, problems[0]);
    const inventory = await readInventory(entry.root, { libraries: sources });
    return send(response, 200, { libraries: inventory.libraries.map(({ root: _root, ...rest }) => { void _root; return rest; }), overrides: inventory.overrides, components: inventory.components.length });
  }
  if (method === 'POST' && action === 'libraries' && parts[3] === 'pull') {
    const input = await body(request);
    const { sources, problems } = validateSources([input.source]);
    if (problems.length || !sources[0]?.git) throw new HttpError(400, problems[0] ?? '只有 git 来源需要拉取');
    try { const pulled = await pullGitLibrary(dataDir(), sources[0]); return send(response, 200, { ok: true, commit: pulled.commit }); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : String(error)); }
  }
  if (method === 'POST' && action === 'find-preview') return send(response, 200, await findPreview(entry.root));
  if (method === 'GET' && action === 'rules') return send(response, 200, await rulesView(entry.root, (await readAccessSettings()).locale));
  if (method === 'POST' && action === 'rules' && parts[3] === 'preview') {
    const input = await body(request);
    const { text } = await validateRules(entry.root, input.raw);
    const current = await readFile(join(entry.root, '.uxqa/rules.json'), 'utf8').catch(() => '');
    return send(response, 200, { ok: true, text, unchanged: current === text, path: '.uxqa/rules.json' });
  }
  if (method === 'POST' && action === 'rules' && parts[3] === 'save') {
    const input = await body(request);
    if (input.confirm !== true) throw new HttpError(400, '保存前需要确认');
    const { text } = await validateRules(entry.root, input.raw);
    await mkdir(join(entry.root, '.uxqa'), { recursive: true });
    await writeFile(join(entry.root, '.uxqa/rules.json'), text);
    return send(response, 200, { saved: '.uxqa/rules.json', rules: await rulesView(entry.root, (await readAccessSettings()).locale) });
  }
  if (method === 'POST' && action === 'baseline') {
    const input = await body(request);
    if (input.confirm !== true) throw new HttpError(400, '记录老问题前需要确认');
    const result = await runCheck({ source: entry.root });
    const baseline = await writeBaseline(join(entry.root, '.uxqa/baseline.json'), result);
    return send(response, 200, { saved: '.uxqa/baseline.json', entries: baseline.entries.length });
  }
  throw new HttpError(404, '没有这个接口');
}

export interface ConsoleServer { url: string; port: number; token: string; close: () => Promise<void> }

export async function startConsole(options: { port?: number; host?: string } = {}): Promise<ConsoleServer> {
  const host = options.host ?? '127.0.0.1';
  // A fixed token is only for development and tests; normal starts get a fresh random one.
  const token = process.env.UXQA_UI_TOKEN && process.env.UXQA_UI_TOKEN.length >= 16 ? process.env.UXQA_UI_TOKEN : randomBytes(18).toString('base64url');
  let port = options.port ?? 0;
  let retentionRun: Promise<void> | undefined;
  const runRetention = () => {
    if (!retentionRun) retentionRun = cleanExpiredScreenshots().then((removed) => { screenshotRetentionStatus = { checkedAt: new Date().toISOString(), removed, error: null }; }).catch((error) => { screenshotRetentionStatus = { checkedAt: new Date().toISOString(), removed: 0, error: error instanceof Error ? error.message : String(error) }; console.error('UXQA screenshot cleanup failed:', error); }).finally(() => { retentionRun = undefined; });
    return retentionRun;
  };
  await runRetention();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      // Only this machine, only under the expected host name (blocks DNS-rebinding pages).
      const hostHeader = request.headers.host ?? '';
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(hostHeader)) return send(response, 403, { error: '只允许从本机地址访问' });
      if (url.pathname.startsWith('/api/')) {
        const supplied = request.headers['x-uxqa-token'] ?? (url.pathname.endsWith('/shot') ? url.searchParams.get('t') : undefined);
        if (supplied !== token) return send(response, 401, { error: '访问令牌不对，请用启动时给出的链接打开' });
        return await route(request, response, url.pathname);
      }
      const asset = ASSETS[url.pathname === '/' ? '/index.html' : url.pathname];
      if (!asset) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, {
        'content-type': asset.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      });
      response.end(asset.encoding === 'base64' ? Buffer.from(asset.body, 'base64') : asset.body);
    } catch (error) {
      const status = error instanceof HttpError || error instanceof EngineRequestError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      const locale = await readAccessSettings().then((settings) => settings.locale).catch(() => null);
      send(response, status, { error: locale === 'en' ? englishUiError(message) : message });
    }
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => done());
  });
  port = (server.address() as { port: number }).port;
  const retentionTimer = setInterval(() => { void runRetention(); }, 60_000);
  retentionTimer.unref();
  return {
    url: `http://127.0.0.1:${port}/#t=${token}`, port, token,
    close: async () => {
      clearInterval(retentionTimer);
      await retentionRun;
      for (const job of jobs.values()) job.controller.abort();
      await Promise.all([...logins.keys()].map(closeLogin));
      await stopEngine();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

export function openInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try {
    const child = spawn(command[0], command.slice(1), { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch { /* the URL is printed anyway */ }
}
