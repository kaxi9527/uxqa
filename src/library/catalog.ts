import { readFile, realpath } from 'node:fs/promises';
import ts from 'typescript';
import { hash } from './paths.js';
import type { ComponentDefinition, NativeCatalog } from './types.js';

function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return unwrap(node.expression);
  if (ts.isCallExpression(node) && node.expression.getText()==='Object.freeze' && node.arguments.length===1) return unwrap(node.arguments[0]);
  return node;
}
function arrayFromSource(source: ts.SourceFile): ts.ArrayLiteralExpression {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text==='COMPONENT_AUTHORITY' && declaration.initializer) {
        const array = unwrap(declaration.initializer);
        if (ts.isArrayLiteralExpression(array)) return array;
      }
    }
  }
  throw new Error('Unsupported TypeScript library catalog: expected a literal COMPONENT_AUTHORITY array');
}
function stringProperty(node: ts.ObjectLiteralExpression, key: string): string {
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text===key) {
      if (ts.isStringLiteralLike(property.initializer)) return property.initializer.text;
    }
  }
  throw new Error(`Native catalog entries must have literal ${key} fields`);
}

export async function readCatalog(path: string): Promise<NativeCatalog> {
  path = await realpath(path);
  const source = await readFile(path,'utf8');
  if (source.length>1_000_000) throw new Error('Component catalog exceeds the 1 MB limit');
  if (path.endsWith('.json')) {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed!=='object' || !Array.isArray(parsed.components)) throw new Error('Unsupported JSON library catalog: expected components array');
    const entries = parsed.components.map((entry: Record<string,unknown>) => {
      if (!entry || typeof entry.id!=='string' || typeof entry.name!=='string') throw new Error('Component catalog entries require id and name');
      return {id:entry.id,name:entry.name};
    });
    return {path,format:'json',source,hash:hash(source),entries};
  }
  const file = ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const syntax = (file as ts.SourceFile & {parseDiagnostics?:ts.Diagnostic[]}).parseDiagnostics;
  if (syntax?.length) throw new Error('Native component catalog contains TypeScript syntax errors');
  const array = arrayFromSource(file);
  const entries = array.elements.map((element) => {
    const object = unwrap(element as ts.Expression);
    if (!ts.isObjectLiteralExpression(object)) throw new Error('Native catalog uses dynamic entries; explicit adapter required');
    return {id:stringProperty(object,'id'),name:stringProperty(object,'name')};
  });
  return {path,format:'synnovator-ts',source,hash:hash(source),entries,
    insertAt:array.elements.end,needsComma:array.elements.length>0 && !array.elements.hasTrailingComma};
}

export function appendCatalog(catalog: NativeCatalog, component: ComponentDefinition, specification: string): string {
  if (catalog.entries.some((entry) => entry.id===component.id || entry.name===component.name)) throw new Error('Component id or name is already registered; reuse or explicitly revise the existing component');
  if (catalog.format==='json') {
    const parsed = JSON.parse(catalog.source);
    parsed.components.push({...component,specification,status:'verified-local'});
    return `${JSON.stringify(parsed,null,2)}\n`;
  }
  const record = {
    id:component.id,name:component.name,level:component.level ?? 'atom-group',status:'candidate-needs-evidence',
    description:component.description,figmaEvidence:[],codeOwner:component.implementation[0],consumers:component.consumers,
    variantAxes:component.variants,states:component.states,slots:[],
    accessibility:component.accessibility,anatomy:component.anatomy,behavior:component.behavior,
    usage:component.usage,antiUsage:component.antiUsage,
    decision:`UXQA local verification passed; specification: ${specification}. Product approval gates still apply.`,
  };
  const insertion = `${catalog.needsComma ? ',':''}\n  ${JSON.stringify(record,null,2).split('\n').join('\n  ')},`;
  const at = catalog.insertAt!;
  return catalog.source.slice(0,at)+insertion+catalog.source.slice(at);
}
