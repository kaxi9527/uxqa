export interface ComponentDefinition {
  id:string;
  name:string;
  description:string;
  implementation:string[];
  consumers:string[];
  states:string[];
  variants:string[];
  anatomy:string[];
  behavior:string[];
  accessibility:string[];
  usage:string[];
  antiUsage:string[];
  props:Array<{name:string;type:string;required:boolean;description:string;default?:string}>;
  level?:'atom'|'atom-group'|'atom-group-set'|'page-pattern';
}
export interface DefinitionInput extends ComponentDefinition {
  operation?:'revise';
  productId:string;
  verification:{testScript:string;typecheckScript:string;qaConfig:string;processTimeoutMs?:number};
}
export interface NativeCatalog {
  path:string;
  format:'json'|'synnovator-ts';
  source:string;
  hash:string;
  entries:Array<{id:string;name:string}>;
  insertAt?:number;
  needsComma?:boolean;
}
export interface LibraryTarget {
  root:string;
  catalog:string;
  format:NativeCatalog['format'];
  catalogHash:string;
  entries:NativeCatalog['entries'];
}
export interface LibraryDiscovery {
  status:'found'|'missing'|'ambiguous';
  productRoot:string;
  productId:string;
  library?:LibraryTarget;
  candidates:LibraryTarget[];
  issues:string[];
}
export interface ComponentPlan {
  schemaVersion:1;
  status:'ready-for-componentization';
  productId:string;
  productRoot:string;
  source:string;
  packageHash:string;
  definitionPath:string;
  definitionHash:string;
  definition:DefinitionInput;
  library:LibraryTarget;
  createdAt:string;
  revision?:{
    recordHash:string;
    specification:string;
    specificationHash:string;
    sourceHashes:Record<string,string>;
  };
}
