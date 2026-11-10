import { dirname, relative, resolve } from 'node:path';
import type { ComponentUsage, ImportConflict, PropPattern, ReuseSummary } from './types.js';

interface Instance {
  importInfo?: {moduleName?:string;imported?:string;local?:string;importType?:string};
  props:Record<string,unknown>; propsSpread?:boolean;
  location:{file:string;start:{line:number}};
}
interface StaticValue {kind:string;value:unknown}

function valueTag(value: unknown): StaticValue {
  if (value && typeof value==='object' && 'kind' in value && 'value' in value) return value as StaticValue;
  return {kind:'legacy-unknown',value:'(unknown)'};
}

export function summarizeReactUsage(report: Record<string,unknown>, stage: string): {components:ComponentUsage[];importConflicts:ImportConflict[];reuse:ReuseSummary} {
  const buckets = new Map<string,Instance[]>();
  const aliasNames = new Map<string,Set<string>>();
  const entries: Array<[string,Instance[]]> = [];
  function visit(value: unknown, name: string): void {
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Unsupported react-scanner schema: component record missing');
    const record = value as Record<string,unknown>;
    if ('instances' in record) {
      if (!Array.isArray(record.instances)) throw new Error('Unsupported react-scanner schema: instances missing');
      entries.push([name,record.instances as Instance[]]);
    }
    for (const [key,child] of Object.entries(record)) {
      if (key!=='instances') visit(child,name ? `${name}.${key}`:key);
    }
  }
  for (const [name,value] of Object.entries(report)) visit(value,name);
  for (const [name,instances] of entries) {
    for (const instance of instances) {
      instance.location.file = relative(stage,instance.location.file);
      let module = instance.importInfo?.moduleName ?? `(local:${instance.location.file})`;
      if (module.startsWith('.')) module = relative(stage,resolve(stage,dirname(instance.location.file),module));
      const root = instance.importInfo?.importType==='ImportDefaultSpecifier' ? 'default' :
        instance.importInfo?.importType==='ImportNamespaceSpecifier' ? '*' : instance.importInfo?.imported ?? name.split('.')[0];
      const suffix = name.split('.').slice(1).join('.');
      const imported = root==='*' ? suffix : [root,suffix].filter(Boolean).join('.');
      if (module.startsWith('(local:') && /^[a-z]/.test(imported)) continue;
      const key = JSON.stringify([module,imported]);
      buckets.set(key,[...(buckets.get(key) ?? []),instance]);
      const aliases = aliasNames.get(key) ?? new Set<string>();
      aliases.add([instance.importInfo?.local ?? name.split('.')[0],suffix].filter(Boolean).join('.'));
      aliasNames.set(key,aliases);
    }
  }
  const components: ComponentUsage[] = [];
  for (const [key,instances] of buckets) {
    const [module,exportName] = JSON.parse(key);
    const aliases = [...aliasNames.get(key)!].sort();
    const name = exportName.startsWith('default') ? aliases[0]:exportName;
    const props = [...new Set(instances.flatMap((instance) => Object.keys(instance.props)))].sort();
    const propPatterns: PropPattern[] = props.map((prop) => {
      let supplied=0,missing=0,spreadUnknown=0,dynamic=0;
      const values = new Map<string,{kind:string;value:unknown;count:number}>();
      for (const instance of instances) {
        if (!Object.hasOwn(instance.props,prop)) {
          if (instance.propsSpread) spreadUnknown++; else missing++;
          continue;
        }
        supplied++;
        const tag = valueTag(instance.props[prop]);
        if (tag.kind==='expression' || tag.kind==='legacy-unknown') dynamic++;
        const identity = JSON.stringify(tag);
        const entry = values.get(identity) ?? {...tag,count:0};
        entry.count++;
        values.set(identity,entry);
      }
      return {prop,supplied,missing,spreadUnknown,dynamic,values:[...values.values()]};
    });
    const locations = instances.map((instance) => ({file:instance.location.file,line:instance.location.start.line}));
    components.push({name,module,count:instances.length,props,locations,propPatterns,aliases,exportName,
      fileCount:new Set(locations.map((location) => location.file)).size,
      spreadInstances:instances.filter((instance) => instance.propsSpread).length});
  }
  components.sort((a,b) => b.fileCount-a.fileCount || b.count-a.count || a.name.localeCompare(b.name));
  const importConflicts: ImportConflict[] = [];
  for (const name of [...new Set(components.map((component) => component.name))].sort()) {
    const sameName = components.filter((component) => component.name===name);
    const modules = [...new Set(sameName.map((component) => component.module))].sort();
    if (modules.length>1) importConflicts.push({name,modules,locations:sameName.flatMap((component) => component.locations)});
  }
  const sharedComponents = components.filter((component) => component.fileCount>1).length;
  return {components,importConflicts,reuse:{componentCount:components.length,sharedComponents,
    singleFileComponents:components.length-sharedComponents,instances:components.reduce((sum,component) => sum+component.count,0)}};
}
