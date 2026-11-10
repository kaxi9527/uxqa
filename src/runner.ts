import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Route } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { measureMotion, measureReflow, traverseKeyboard } from './a11y-checks.js';
import { readGitState, UXQA_VERSION } from './evidence.js';
import { matchesUrl } from './glob.js';
import { executeStep } from './steps.js';
import type { CheckResult, DataNature, Finding, FlowConfig, HarnessConfig, RunEvidence, RunResult } from './types.js';

export interface RunOptions {
  outDir: string;
  headed?: boolean;
}

type NewCheck = Omit<CheckResult, 'id'>;

const REFLOW_CHECKS = [
  { check: 'reflow-320', viewport: 'reflow-320x256', width: 320, height: 256, detail: 'WCAG 1.4.10 reflow at 320 CSS px' },
  { check: 'zoom-200', viewport: 'zoom-200 (1280px at 200% = 640x400)', width: 640, height: 400, detail: '200% browser zoom of a 1280 px window' },
] as const;

const ENVIRONMENT_ERROR = /ERR_CONNECTION|ERR_UNSAFE_PORT|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED|ERR_TIMED_OUT|ECONNREFUSED|ENOTFOUND|net::ERR_CERT|storageState|ENOENT/i;

function absoluteUrl(baseUrl: string, route: string): string {
  return new URL(route, baseUrl).toString();
}

function safeName(value: string): string {
  const readable = value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0,60) || 'run';
  return `${readable}-${createHash('sha256').update(value).digest('hex').slice(0,8)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function flowDataNature(flow: FlowConfig, base: DataNature): DataNature {
  return flow.offline || flow.network?.some((rule) => rule.abort || rule.respond) ? 'mock' : base;
}

async function installNetworkRules(page: Page, flow: FlowConfig, injected: WeakSet<Request>): Promise<void> {
  for (const rule of flow.network ?? []) {
    let used = 0;
    await page.route((url) => matchesUrl(rule.match, url.toString()), async (route: Route) => {
      const request = route.request();
      if ((rule.method && request.method() !== rule.method) || (rule.times !== undefined && used >= rule.times)) return route.fallback();
      used++;
      if (rule.delayMs) await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
      if (rule.abort) { injected.add(request); return route.abort(rule.abort); }
      if (rule.respond) {
        const { status, json, body, contentType, headers } = rule.respond;
        const isJson = json !== undefined;
        return route.fulfill({ status, headers, contentType: contentType ?? (isJson ? 'application/json' : 'text/plain'), body: isJson ? JSON.stringify(json) : body ?? '' });
      }
      return route.fallback();
    });
  }
}

export async function runAudit(config: HarnessConfig, options: RunOptions): Promise<RunResult> {
  await mkdir(options.outDir, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const findings: Finding[] = [];
  const artifacts: string[] = [];
  const checks: CheckResult[] = [];
  const notApplicable = new Map(config.notApplicable.map((entry) => [entry.check, entry.reason]));
  const keyboardEvidence: string[] = [];
  const addCheck = (check: NewCheck) => { checks.push({ id: `${check.check}-${checks.length + 1}`, ...check }); };
  const declared = (check: string, base: Omit<NewCheck, 'status' | 'detail' | 'check'>): boolean => {
    const reason = notApplicable.get(check);
    if (reason === undefined) return false;
    addCheck({ ...base, check, status: 'not-applicable', detail: reason });
    return true;
  };
  const evidence: RunEvidence = {
    uxqaVersion: UXQA_VERSION,
    baseUrl: config.baseUrl,
    ...(config.evidence.environment ? { environment: config.evidence.environment } : {}),
    dataNature: config.evidence.dataNature,
    headless: !options.headed,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    product: config.evidence.productRoot ? { root: config.evidence.productRoot, git: await readGitState(config.evidence.productRoot) } : {},
  };
  let browser: Browser | undefined;
  const newContext = (viewport: { width: number; height: number }, extra: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> =>
    browser!.newContext({ viewport, ...(config.storageState ? { storageState: config.storageState } : {}), ...extra });

  try {
    browser = await chromium.launch({ headless: !options.headed });
    evidence.browser = `chromium ${browser.version()}`;
    for (const viewport of config.viewports) {
      for (const route of config.routes) {
        const routeFlows = config.flows.filter((candidate) => !candidate.route || candidate.route === route);
        const label = `${safeName(route)}-${safeName(viewport.name)}`;
        const where = { route, viewport: viewport.name };
        let context: BrowserContext;
        try { context = await newContext({ width: viewport.width, height: viewport.height }); }
        catch (error) {
          findings.push({ id: `page-${label}`, severity: 'blocking', kind: 'page', message: errorMessage(error), ...where });
          addCheck({ check: 'page-load', dimension: 'engineering', status: 'blocked', detail: errorMessage(error), ...where });
          continue;
        }
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.setDefaultNavigationTimeout(20_000);
        const pageErrors: Array<{ message: string; injected: boolean }> = [];
        const requestFailures: Array<{ message: string; injected: boolean }> = [];
        const injectedRequests = new WeakSet<Request>();
        let injecting = false;
        let flowRequests: Array<{ method: string; url: string }> = [];
        page.on('pageerror', (error) => pageErrors.push({ message: error.message, injected: injecting }));
        page.on('console', (message) => {
          if (message.type() === 'error') pageErrors.push({ message: `console.error: ${message.text()}`, injected: injecting });
        });
        page.on('request', (request) => flowRequests.push({ method: request.method(), url: request.url() }));
        page.on('requestfailed', (request) => requestFailures.push({ message: `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`, injected: injecting || injectedRequests.has(request) }));
        const tracePath = join(options.outDir, `${label}.trace.zip`);
        if (config.options.trace !== 'off') await context.tracing.start({ screenshots: true, snapshots: true });
        let loaded = false;

        try {
          try {
            const response = await page.goto(absoluteUrl(config.baseUrl, route), { waitUntil: 'load' });
            if (response && response.status() >= 400) throw new Error(`Page returned HTTP ${response.status()}`);
            loaded = true;
          } catch (error) {
            const message = errorMessage(error);
            const status = ENVIRONMENT_ERROR.test(message) ? 'blocked' : 'fail';
            findings.push({ id: `page-${label}`, severity: 'blocking', kind: 'page', message, ...where });
            addCheck({ check: 'page-load', dimension: 'engineering', status, detail: status === 'blocked' ? `Environment unavailable: ${message}` : message, ...where });
            const reason = 'Blocked: page did not load';
            if (!declared('axe', { dimension: 'accessibility', ...where })) addCheck({ check: 'axe', dimension: 'accessibility', status: 'blocked', detail: reason, ...where });
            if (!declared('keyboard-focus', { dimension: 'accessibility', ...where })) addCheck({ check: 'keyboard-focus', dimension: 'accessibility', status: 'blocked', detail: reason, ...where });
            for (const flow of routeFlows) addCheck({ check: 'flow', dimension: 'behavior', status: 'blocked', detail: reason, flow: flow.name, ...(flow.requirement ? { requirement: flow.requirement } : {}), dataNature: flowDataNature(flow, config.evidence.dataNature), ...where });
          }

          if (loaded) {
            const bodyText = await page.locator('body').innerText().catch(() => '');
            if (bodyText.trim().length === 0) {
              findings.push({ id: `page-blank-${label}`, severity: 'blocking', kind: 'page', message: 'Page rendered no meaningful body text', ...where });
              addCheck({ check: 'page-load', dimension: 'engineering', status: 'fail', detail: 'Page loaded but rendered no meaningful body text', ...where });
            } else addCheck({ check: 'page-load', dimension: 'engineering', status: 'pass', detail: 'Loaded with visible body text', ...where });

            if (!declared('axe', { dimension: 'accessibility', ...where })) {
              if (!config.options.axe) addCheck({ check: 'axe', dimension: 'accessibility', status: 'not-verified', detail: 'axe disabled by options.axe', ...where });
              else {
                try {
                  const tags = config.options.bestPractice === 'off' ? config.options.axeTags : [...config.options.axeTags, 'best-practice'];
                  const axeResults = await new AxeBuilder({ page }).withTags(tags).analyze();
                  let blocking = 0;
                  let advisory = 0;
                  for (const violation of axeResults.violations) {
                    const conformance = violation.tags.some((tag) => config.options.axeTags.includes(tag));
                    const severity = conformance || config.options.bestPractice === 'blocking' ? 'blocking' : 'info';
                    if (severity === 'blocking') blocking++; else advisory++;
                    findings.push({
                      id: `a11y-${label}-${violation.id}`, severity, kind: 'accessibility',
                      message: `${violation.help} (${violation.nodes.length} node(s); ${violation.impact ?? 'unknown'} impact; ${conformance ? violation.tags.filter((tag) => /^wcag\d/.test(tag)).join(' ') : 'best practice'})`,
                      ...where, evidence: violation.nodes.flatMap((node) => node.target.map(String)),
                    });
                  }
                  addCheck({ check: 'axe', dimension: 'accessibility', status: blocking ? 'fail' : 'pass', detail: `axe ${axeResults.testEngine.version} tags ${tags.join(',')}: ${blocking} conformance violation(s), ${advisory} advisory; automated scan only`, ...where });
                } catch (error) {
                  addCheck({ check: 'axe', dimension: 'accessibility', status: 'blocked', detail: `axe could not run: ${errorMessage(error)}`, ...where });
                }
              }
            }

            if (config.options.screenshots) {
              const screenshot = join(options.outDir, `${label}.png`);
              await page.screenshot({ path: screenshot, fullPage: true });
              artifacts.push(screenshot);
            }

            if (!declared('keyboard-focus', { dimension: 'accessibility', ...where })) {
              if (!config.options.keyboard) addCheck({ check: 'keyboard-focus', dimension: 'accessibility', status: 'not-verified', detail: 'Keyboard traversal disabled by options.keyboard', ...where });
              else {
                try {
                  const keyboard = await traverseKeyboard(page, config.options.maxTabStops);
                  const file = join(options.outDir, `keyboard-${label}.json`);
                  await writeFile(file, JSON.stringify(keyboard, null, 2), { mode: 0o600 });
                  artifacts.push(file);
                  keyboardEvidence.push(file);
                  const problems: string[] = [];
                  if (keyboard.trapped) problems.push(`focus trapped on ${keyboard.trapped}`);
                  if (keyboard.missingIndicator.length) problems.push(`${keyboard.missingIndicator.length} stop(s) without a detectable focus style change`);
                  if (keyboard.obscured.length) problems.push(`${keyboard.obscured.length} focused element(s) fully covered by other content`);
                  if (keyboard.unfocusableControls.length) problems.push(`${keyboard.unfocusableControls.length} custom control(s) with an interactive role but no tabindex`);
                  const push = (message: string, items: string[]) => findings.push({ id: `keyboard-${label}-${findings.length}`, severity: 'blocking', kind: 'keyboard', message, ...where, evidence: [...items.slice(0, 10), file] });
                  if (keyboard.trapped) push('Keyboard focus is trapped: Tab does not move focus', [keyboard.trapped]);
                  if (keyboard.missingIndicator.length) push('Focused element shows no visible focus indicator (computed style unchanged on focus; confirm manually)', keyboard.missingIndicator.map((stop) => `${stop.element} "${stop.name}"`));
                  if (keyboard.obscured.length) push('Focused element is entirely obscured by other content', keyboard.obscured.map((stop) => `${stop.element} "${stop.name}"`));
                  if (keyboard.unfocusableControls.length) push('Custom control is not reachable with Tab', keyboard.unfocusableControls);
                  const coverage = `${keyboard.stops.length} Tab stop(s)${keyboard.complete ? ', full cycle' : `, stopped at limit ${config.options.maxTabStops}`}`;
                  addCheck({
                    check: 'keyboard-focus', dimension: 'accessibility',
                    status: problems.length ? 'fail' : keyboard.complete || keyboard.stops.length === 0 ? 'pass' : 'not-verified',
                    detail: problems.length ? `${coverage}: ${problems.join('; ')}` : keyboard.stops.length === 0 ? 'No focusable elements on the page' : keyboard.complete ? `${coverage}; every stop changed style on focus and was not covered` : `${coverage}; traversal incomplete, raise options.maxTabStops`,
                    ...where, evidence: [file],
                  });
                } catch (error) {
                  addCheck({ check: 'keyboard-focus', dimension: 'accessibility', status: 'blocked', detail: `Keyboard traversal could not run: ${errorMessage(error)}`, ...where });
                }
              }
            }

            for (const flow of routeFlows) {
              const requirement = flow.requirement ? { requirement: flow.requirement } : {};
              const dataNature = flowDataNature(flow, config.evidence.dataNature);
              let failure: string | undefined;
              let failedStep: string | undefined;
              const flowEvidence: string[] = [];
              injecting = !!(flow.network?.length || flow.offline);
              flowRequests = [];
              try {
                await installNetworkRules(page, flow, injectedRequests);
                await page.goto(absoluteUrl(config.baseUrl, route), { waitUntil: 'load' });
                if (flow.offline) await context.setOffline(true);
                for (const [index, step] of flow.steps.entries()) {
                  try {
                    await executeStep(page, step, { requests: flowRequests });
                  } catch (error) {
                    failure = errorMessage(error);
                    failedStep = `${flow.name} step ${index + 1} (${step.action})`;
                    break;
                  }
                }
              } catch (error) {
                failure = errorMessage(error);
                failedStep = `${flow.name} setup`;
              } finally {
                if (flow.offline) await context.setOffline(false).catch(() => undefined);
                await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
              }
              if (config.options.screenshots) {
                const screenshot = join(options.outDir, failure ? `${label}-${safeName(flow.name)}-failure.png` : `${label}-flow-${safeName(flow.name)}.png`);
                await page.screenshot({ path: screenshot, fullPage: true }).then(() => { flowEvidence.push(screenshot); artifacts.push(screenshot); }).catch(() => undefined);
              }
              injecting = false;
              if (failure) findings.push({ id: `flow-${label}-${safeName(flow.name)}`, severity: 'blocking', kind: 'flow', message: failure, ...where, step: failedStep, ...requirement, evidence: flowEvidence });
              addCheck({
                check: 'flow', dimension: 'behavior', status: failure ? 'fail' : 'pass', flow: flow.name, ...requirement, dataNature,
                detail: `${flow.expected ? `${flow.expected} — ` : ''}${failure ? `failed at ${failedStep}: ${failure}` : `${flow.steps.length} step(s) passed`}${dataNature === 'mock' ? ' [simulated network/offline state; not real integration]' : ''}`,
                ...where, evidence: flowEvidence,
              });
            }
          }
        } finally {
          try {
            const realErrors = [...new Set(pageErrors.filter((entry) => !entry.injected).map((entry) => entry.message))];
            const realFailures = [...new Set(requestFailures.filter((entry) => !entry.injected).map((entry) => entry.message))];
            for (const message of realErrors) findings.push({ id: `console-${label}-${findings.length}`, severity: 'blocking', kind: 'console', message, ...where });
            for (const message of realFailures) findings.push({ id: `network-${label}-${findings.length}`, severity: 'blocking', kind: 'network', message, ...where });
            for (const message of new Set(pageErrors.filter((entry) => entry.injected).map((entry) => entry.message))) findings.push({ id: `console-${label}-${findings.length}`, severity: 'info', kind: 'console', message: `${message} (during a fault-injected flow; review whether the product handled it)`, ...where });
            for (const message of new Set(requestFailures.filter((entry) => entry.injected).map((entry) => entry.message))) findings.push({ id: `network-${label}-${findings.length}`, severity: 'info', kind: 'network', message: `${message} (injected by flow network rules)`, ...where });
            const status = loaded ? undefined : 'blocked';
            addCheck({ check: 'console', dimension: 'engineering', status: status ?? (realErrors.length ? 'fail' : 'pass'), detail: status ? 'Blocked: page did not load' : `${realErrors.length} uncaught error(s) or console.error message(s) outside fault injection`, ...where });
            addCheck({ check: 'network', dimension: 'data', status: status ?? (realFailures.length ? 'fail' : 'pass'), detail: status ? 'Blocked: page did not load' : `${realFailures.length} failed request(s) outside fault injection`, ...where });
            if (config.options.trace !== 'off') {
              const failed = findings.some((finding) => finding.route===route && finding.viewport===viewport.name && finding.severity==='blocking');
              if (config.options.trace==='always' || failed) {
                await context.tracing.stop({path:tracePath}); artifacts.push(tracePath);
              } else await context.tracing.stop();
            }
          } finally { await context.close(); }
        }
      }
    }

    for (const route of config.routes) {
      for (const reflow of REFLOW_CHECKS) {
        const where = { route, viewport: reflow.viewport };
        if (declared(reflow.check, { dimension: 'responsive', ...where })) continue;
        if (!config.options.reflow) { addCheck({ check: reflow.check, dimension: 'responsive', status: 'not-verified', detail: 'Reflow checks disabled by options.reflow', ...where }); continue; }
        const context = await newContext({ width: reflow.width, height: reflow.height });
        try {
          const page = await context.newPage();
          await page.goto(absoluteUrl(config.baseUrl, route), { waitUntil: 'load', timeout: 20_000 });
          await page.waitForTimeout(150);
          const result = await measureReflow(page, config.options.reflowExceptions);
          const label = `${safeName(route)}-${reflow.check}`;
          const shot: string[] = [];
          if (config.options.screenshots) { const file = join(options.outDir, `${label}.png`); await page.screenshot({ path: file, fullPage: true }); artifacts.push(file); shot.push(file); }
          if (result.overflow) findings.push({ id: `reflow-${label}`, severity: 'blocking', kind: 'reflow', message: `Horizontal scrolling at ${reflow.width} CSS px (document ${result.scrollWidth}px wide); exempt genuine two-dimensional content via options.reflowExceptions`, ...where, evidence: [...result.offenders, ...shot] });
          if (result.clippedText.length) findings.push({ id: `reflow-clip-${label}`, severity: 'info', kind: 'reflow', message: `Text extends past the viewport edge at ${reflow.width} CSS px; check for clipped content`, ...where, evidence: [...result.clippedText, ...shot] });
          addCheck({ check: reflow.check, dimension: 'responsive', status: result.overflow ? 'fail' : 'pass', detail: `${reflow.detail}: document ${result.scrollWidth}px vs viewport ${result.width}px${result.clippedText.length ? `; ${result.clippedText.length} possibly clipped text element(s)` : ''}`, ...where, evidence: shot });
        } catch (error) {
          const message = errorMessage(error);
          addCheck({ check: reflow.check, dimension: 'responsive', status: ENVIRONMENT_ERROR.test(message) ? 'blocked' : 'fail', detail: message, ...where });
        } finally { await context.close(); }
      }

      const motionViewport = config.viewports[0];
      const motionWhere = { route, viewport: `${motionViewport.name} + prefers-reduced-motion` };
      if (declared('reduced-motion', { dimension: 'accessibility', ...motionWhere })) continue;
      if (!config.options.reducedMotion) { addCheck({ check: 'reduced-motion', dimension: 'accessibility', status: 'not-verified', detail: 'Reduced-motion check disabled by options.reducedMotion', ...motionWhere }); continue; }
      const context = await newContext({ width: motionViewport.width, height: motionViewport.height }, { reducedMotion: 'reduce' });
      try {
        const page = await context.newPage();
        await page.goto(absoluteUrl(config.baseUrl, route), { waitUntil: 'load', timeout: 20_000 });
        await page.waitForTimeout(500);
        const motion = await measureMotion(page);
        const moving = motion.persistent.length + motion.autoplayVideos;
        if (moving) findings.push({ id: `motion-${safeName(route)}`, severity: 'info', kind: 'motion', message: `With prefers-reduced-motion: reduce, ${motion.persistent.length} long or infinite animation(s) and ${motion.autoplayVideos} autoplaying video(s) keep running; confirm a pause control or that the motion is essential`, ...motionWhere, evidence: motion.persistent });
        addCheck({ check: 'reduced-motion', dimension: 'accessibility', status: moving ? 'not-verified' : 'pass', detail: moving ? `${moving} persistent motion source(s) still running under reduced motion; needs human judgement` : 'No long or infinite animation running under prefers-reduced-motion: reduce', ...motionWhere });
      } catch (error) {
        const message = errorMessage(error);
        addCheck({ check: 'reduced-motion', dimension: 'accessibility', status: ENVIRONMENT_ERROR.test(message) ? 'blocked' : 'fail', detail: message, ...motionWhere });
      } finally { await context.close(); }
    }
  } catch (error) {
    findings.push({id:'browser-infrastructure',severity:'blocking',kind:'page',message:errorMessage(error),route:'(browser)',viewport:'(all)'});
    addCheck({ check: 'page-load', dimension: 'engineering', status: 'blocked', detail: `Browser infrastructure failed: ${errorMessage(error)}`, route: '(browser)', viewport: '(all)' });
  } finally {
    await browser?.close();
  }

  // Coverage the browser run cannot provide is listed explicitly rather than implied by a pass.
  const global = { route: '(all)', viewport: '(all)' };
  const gap = (check: string, dimension: CheckResult['dimension'], detail: string, extra: Partial<NewCheck> = {}) => {
    if (!declared(check, { dimension, ...global })) addCheck({ check, dimension, status: 'not-verified', detail, ...global, ...extra });
  };
  gap('screen-reader', 'accessibility', 'Screen reader output was not exercised; check key flows with VoiceOver/NVDA');
  if (config.options.keyboard) gap('tab-order-logic', 'accessibility', 'Tab order is recorded in keyboard-*.json; whether it follows a logical reading order needs human review', { evidence: keyboardEvidence });
  gap('design-fidelity', 'design', 'No comparison with the design source or an approved baseline; screenshots are evidence, not a visual verdict');
  gap('real-device', 'responsive', 'Real devices, landscape, safe areas and on-screen keyboards were not verified (desktop Chromium emulation only)');
  const mockedFlows = config.flows.filter((flow) => flowDataNature(flow, config.evidence.dataNature) === 'mock').length;
  if (config.evidence.dataNature !== 'real') gap('real-api', 'data', `Test data is "${config.evidence.dataNature}"; real API integration was not verified by this run`);
  else if (mockedFlows) gap('real-api', 'data', `${mockedFlows} flow(s) used simulated network state; only the remaining flows ran against real data`);
  const git = evidence.product.git;
  if (!declared('code-revision', { dimension: 'engineering', ...global })) {
    if (git?.revision) addCheck({ check: 'code-revision', dimension: 'engineering', status: 'pass', detail: `Recorded ${git.branch ?? 'detached'}@${git.revision.slice(0, 12)}${git.dirty ? ` with ${git.changedFiles} uncommitted change(s)` : ', clean worktree'}`, ...global });
    else addCheck({ check: 'code-revision', dimension: 'engineering', status: 'not-verified', detail: git?.error ?? 'evidence.productRoot not configured; the tested code revision is unrecorded', ...global });
  }
  gap('engineering-gates', 'engineering', 'Typecheck, lint, build and unit/integration tests are outside uxqa run; record them separately');
  gap('deployment', 'operations', 'Deployment, release and rollback were not verified; a local or preview run is not deployment evidence');

  return { configName: config.name, startedAt, endedAt: new Date().toISOString(), findings, artifacts, checks, evidence };
}
