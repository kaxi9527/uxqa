import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { Observation } from './types.js';

export const DEFAULT_SELECTOR = 'button,input,select,textarea,form,article,dialog,[role="dialog"],[role="tablist"],[role="button"],[data-uxqa-component],[class*="card" i],[class*="panel" i]';

export async function collectObservations(page: Page, route: string, viewport: string, state: string, outDir: string, selector = DEFAULT_SELECTOR): Promise<Observation[]> {
  const snapshots = await page.locator(selector).evaluateAll((elements) => {
    function path(element: Element): string {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current.tagName !== 'HTML') {
        const tag = current.tagName.toLowerCase();
        const siblings = Array.from(current.parentElement?.children ?? []).filter((entry) => entry.tagName === current!.tagName);
        parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current)+1})`);
        current = current.parentElement;
      }
      return parts.join(' > ');
    }
    function structure(element: Element, budget: {nodes:number}, depth = 0): string {
      if (++budget.nodes > 64 || depth > 5) return '#truncated';
      const tag = element.tagName.toLowerCase();
      if (tag === 'svg' || tag === 'img') return '#media';
      const normalized = /^h[1-6]$/.test(tag) ? 'heading':tag;
      const role = element.getAttribute('role');
      const type = tag === 'input' ? (element.getAttribute('type') ?? 'text'):undefined;
      const children = Array.from(element.children).filter((child) => !['SCRIPT','STYLE','TEMPLATE'].includes(child.tagName));
      return `${normalized}${role ? `[${role}]`:''}${type ? `[${type}]`:''}(${children.map((child) => structure(child,budget,depth+1)).join(',')})`;
    }
    const properties = ['display','color','backgroundColor','fontFamily','fontSize','fontWeight','lineHeight','padding','gap','borderRadius','borderColor','borderWidth','boxShadow','flexDirection','alignItems','textAlign'];
    return elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width>0 && rect.height>0 && style.visibility!=='hidden' && style.display!=='none' && style.opacity!=='0';
    }).slice(0,60).map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role');
      const family = role==='dialog' || tag==='dialog' ? 'dialog' : role==='tablist' ? 'tabs' :
        tag==='button' || role==='button' ? 'button' : ['input','select','textarea'].includes(tag) ? 'field' :
        tag==='form' ? 'form' : 'card';
      return { family,selector:path(element),structure:structure(element,{nodes:0}),
        styles:Object.fromEntries(properties.map((property) => [property,String(style[property as keyof CSSStyleDeclaration])])),
        bounds:{x:rect.x+window.scrollX,y:rect.y+window.scrollY,width:rect.width,height:rect.height} };
    });
  });

  const observations: Observation[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.structure.includes('#truncated')) continue;
    const id = createHash('sha256').update(JSON.stringify([route,viewport,state,snapshot.selector])).digest('hex').slice(0,16);
    const screenshot = join(outDir,`${id}.png`);
    const observation: Observation = { ...snapshot,id,route,url:page.url(),viewport,state };
    try {
      await page.locator(snapshot.selector).screenshot({path:screenshot,timeout:5000});
      observation.screenshot = screenshot;
    } catch { /* A detached or animated element remains an observation without screenshot proof. */ }
    observations.push(observation);
  }
  return observations;
}
