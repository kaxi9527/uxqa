import { writeFile } from 'node:fs/promises';
import { extractBranding } from 'dembrandt/extractors';
import type { Browser, BrowserContext, ViewportSize } from 'playwright';
import type { ToolRun } from './types.js';

export function tokenHealthError(meta?: {httpStatus?:number|null;errors?:Array<{stage:string}>;degraded?:string[];timeouts?:string[]}): string | undefined {
  if (meta?.httpStatus && meta.httpStatus>=400) return `Dembrandt observed HTTP ${meta.httpStatus}`;
  const problems = [...(meta?.errors?.map((error) => error.stage) ?? []),...(meta?.degraded ?? []),...(meta?.timeouts ?? [])];
  return problems.length ? `Dembrandt extraction incomplete: ${problems.join(', ')}`:undefined;
}

export async function auditDesignTokens(browser: Browser, url: string, viewport: ViewportSize, artifact: string, storageState?: string): Promise<ToolRun> {
  const contexts: BrowserContext[] = [];
  let expired = false;
  const configuredBrowser = new Proxy(browser, {
    get(target,key) {
      if (key === 'newContext') return async (options: Parameters<Browser['newContext']>[0]) => {
        if (expired) throw new Error('Dembrandt analysis timed out');
        const context = await target.newContext({...options,viewport,...(storageState ? {storageState}: {})});
        contexts.push(context);
        return context;
      };
      const value = Reflect.get(target,key,target);
      return typeof value === 'function' ? value.bind(target):value;
    },
  });
  const spinner = {
    text:'', start() { return this; }, stop() { return this; }, succeed() { return this; },
    fail() { return this; }, warn() { return this; }, info() { return this; },
  };
  const timer = setTimeout(() => { expired = true; for (const context of contexts) void context.close().catch(() => {}); },60_000);
  try {
    const result = await extractBranding(url,spinner,configuredBrowser,{
      reveal:false,voice:false,teach:false,keepAnimations:true,discoverLinks:0,
      navigationTimeout:15_000,mobile:viewport.width<768,_version:'0.38.0',
    });
    if (expired) throw new Error('Dembrandt analysis timed out after 60000ms');
    await writeFile(artifact,JSON.stringify(result,null,2),{mode:0o600});
    const problem = tokenHealthError(result.meta);
    if (problem) return {name:'dembrandt',version:'0.38.0',status:'failed',artifact,error:problem};
    return {name:'dembrandt',version:'0.38.0',status:'complete',artifact};
  } catch (error) {
    return {name:'dembrandt',version:'0.38.0',status:'failed',error:error instanceof Error ? error.message:String(error)};
  } finally {
    clearTimeout(timer);
    for (const context of contexts) await context.close().catch(() => {});
  }
}
