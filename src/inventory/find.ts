import { COMPONENT_WORDS } from './semantics.js';
import { componentByName, type Inventory, type LibraryComponent } from './read.js';
import { basename, extname } from 'node:path';

export interface ComponentMatch { component: LibraryComponent; score: number; why: string }

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Plain lookup: "按钮", "tabs", "下拉菜单", "Button". Honest about no match: returns an empty list. */
export function findComponents(inventory: Inventory, query: string, limit = 5): ComponentMatch[] {
  const terms = query.toLowerCase().split(/[\s,，、]+/).filter(Boolean);
  if (!terms.length) return [];
  const matches: ComponentMatch[] = [];
  const seen = new Set<string>();
  for (const component of inventory.components) {
    const key = `${component.file}:${component.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (/Icon$/.test(component.name) && !terms.some((term) => term.includes('icon') || term.includes('图标'))) continue;
    // A second definition of the same name (a compatibility copy) is never suggested; the check reports it as a duplicate.
    if (componentByName(inventory, component.name)?.file !== component.file) continue;
    const name = component.name.toLowerCase();
    const fileName = basename(component.file, extname(component.file)).toLowerCase();
    const wordsKey = [kebab(component.name), fileName, kebab(component.name).split('-')[0]].find((candidate) => COMPONENT_WORDS[candidate]);
    const words = wordsKey ? [COMPONENT_WORDS[wordsKey].label, ...COMPONENT_WORDS[wordsKey].words].map((word) => word.toLowerCase()) : [];
    let score = 0;
    const why: string[] = [];
    for (const term of terms) {
      if (name === term) { score += 10; why.push(`名字是 ${component.name}`); }
      else if (name.includes(term) || fileName.includes(term)) { score += 5; why.push(`名字里有 ${term}`); }
      if (words.some((word) => word === term)) { score += 8; why.push(`它就是"${term}"`); }
      else if (words.some((word) => word.includes(term) || term.includes(word))) { score += 4; why.push(`和"${term}"相关`); }
    }
    if (!score) continue;
    // Prefer the main export of a file (Tabs over TabsContent) and the file named after the component.
    if (kebab(component.name) === fileName) score += 2;
    matches.push({ component, score, why: [...new Set(why)].join('，') });
  }
  // One result per file: the best-scoring export stands for its parts (Tabs for TabsList/TabsTrigger).
  const best = new Map<string, ComponentMatch>();
  for (const match of matches.sort((a, b) => b.score - a.score || a.component.name.length - b.component.name.length)) {
    if (!best.has(match.component.file)) best.set(match.component.file, match);
  }
  return [...best.values()].slice(0, limit);
}
