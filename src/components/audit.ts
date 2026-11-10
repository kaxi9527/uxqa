import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { executeStep } from '../steps.js';
import type { HarnessConfig } from '../types.js';
import { collectObservations } from './collect.js';
import { groupObservations } from './groups.js';
import { auditSource, validateSourcePaths } from './source.js';
import { auditDesignTokens } from './tokens.js';
import { analyzePageCss } from './css.js';
import type { ComponentAudit } from './types.js';
import { discoverLibrary } from '../library/discovery.js';

export interface ComponentAuditOptions { outDir:string; sourceDir?:string; selector?:string; headed?:boolean; designTokens?:boolean;libraryDir?:string }

export async function auditComponents(config: HarnessConfig | undefined, options: ComponentAuditOptions): Promise<ComponentAudit> {
  if (options.sourceDir) await validateSourcePaths(options.sourceDir,options.outDir);
  const library=options.sourceDir ? await discoverLibrary(options.sourceDir,options.libraryDir):undefined;
  await mkdir(options.outDir,{recursive:true,mode:0o700});
  const result: ComponentAudit = {name:config?.name ?? 'source-components',startedAt:new Date().toISOString(),endedAt:'',
    status:'complete',coverage:[],observations:[],candidates:[],tools:[],css:[],library,limitations:[
      'Candidates are structural/style suggestions; business responsibilities and accessibility behavior require human review.',
      'Only configured routes, viewports, and successfully exercised flow states are observed.',
      'At most 60 visible blocks per state; trees deeper than 5 levels or larger than 64 nodes are excluded.',
      'Cross-origin frames, closed shadow DOM, canvas-only controls and unvisited states are outside coverage.',
      'DOM candidates and source usage are separate evidence; no automatic source binding or refactoring is performed.',
      'CSS metrics count authored values, not rendered color equivalence; unavailable stylesheets are explicit coverage gaps.',
      'React attribute values are static observations; expressions, spreads and runtime defaults are not resolved.',
      'Componentization requires a unique product library before implementation; candidate audits do not register components.',
    ]};
  if (config) {
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({headless:!options.headed});
      for (const viewport of config.viewports) {
        for (const route of config.routes) {
          const context = await browser.newContext({viewport:{width:viewport.width,height:viewport.height},
            ...(config.storageState ? {storageState:config.storageState}:{})});
          const row = {route,viewport:viewport.name,state:'initial'};
          const url = new URL(route,config.baseUrl).href;
          try {
            const page = await context.newPage();
            page.setDefaultTimeout(8000);
            page.setDefaultNavigationTimeout(20_000);
            const response = await page.goto(url,{waitUntil:'load'});
            if (response && response.status() >= 400) throw new Error(`Page returned HTTP ${response.status()}`);
            await page.locator('body').waitFor({state:'visible'});
            const initial = await collectObservations(page,route,viewport.name,'initial',options.outDir,options.selector);
            result.observations.push(...initial);
            const css = await analyzePageCss(page);
            const cssId = createHash('sha256').update(JSON.stringify([route,viewport.name])).digest('hex').slice(0,12);
            css.artifact = join(options.outDir,`css-${cssId}.json`);
            await writeFile(css.artifact,JSON.stringify(css,null,2),{mode:0o600});
            result.css.push({route,viewport:viewport.name,audit:css});
            result.tools.push({name:'project-wallace',version:'9.9.3',status:css.status,artifact:css.artifact,error:css.gaps.length ? css.gaps.join('; '):undefined});
            result.coverage.push({...row,status:'complete'});
            for (const flow of config.flows.filter((entry) => !entry.route || entry.route === route)) {
              const state = `flow:${flow.name}`;
              try {
                await page.goto(url,{waitUntil:'load'});
                for (const step of flow.steps) await executeStep(page,step);
                result.observations.push(...await collectObservations(page,route,viewport.name,state,options.outDir,options.selector));
                result.coverage.push({...row,state,status:'complete'});
              } catch (error) { result.coverage.push({...row,state,status:'failed',error:error instanceof Error ? error.message:String(error)}); }
            }
          } catch (error) { result.coverage.push({...row,status:'failed',error:error instanceof Error ? error.message:String(error)}); }
          finally { await context.close(); }

          if (options.designTokens !== false && result.coverage.some((entry) => entry.route===route && entry.viewport===viewport.name && entry.state==='initial' && entry.status==='complete')) {
            const id = createHash('sha256').update(JSON.stringify([route,viewport.name])).digest('hex').slice(0,12);
            result.tools.push(await auditDesignTokens(browser,url,viewport,join(options.outDir,`tokens-${id}.json`),config.storageState));
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message:String(error);
      result.tools.push({name:'playwright',version:'installed',status:'failed',error:message});
      for (const viewport of config.viewports) for (const route of config.routes) {
        if (!result.coverage.some((entry) => entry.route===route && entry.viewport===viewport.name && entry.state==='initial')) {
          result.coverage.push({route,viewport:viewport.name,state:'initial',status:'failed',error:message});
        }
      }
    } finally { await browser?.close(); }
  }
  if (options.sourceDir) {
    result.source = await auditSource(options.sourceDir,join(options.outDir,'source'));
    result.tools.push(...result.source.tools);
  }
  result.candidates = groupObservations(result.observations);
  result.status = result.coverage.some((entry) => entry.status==='failed') || result.tools.some((tool) => tool.status==='failed' || tool.status==='partial') ? 'partial':'complete';
  result.endedAt = new Date().toISOString();
  return result;
}
