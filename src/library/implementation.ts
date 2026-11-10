import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { inside } from '../components/source.js';
import { boundPath } from './paths.js';
import type { ComponentPlan } from './types.js';

export async function verifyImplementation(plan: ComponentPlan): Promise<void> {
  const root=plan.productRoot;
  let exportsComponent=false;
  for (const path of plan.definition.implementation) {
    const file=await boundPath(root,path);
    if (!inside(plan.library.root,file)) throw new Error('Implementation is outside the product library');
    const source=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
    for (const statement of source.statements) {
      const exported=ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier)=>modifier.kind===ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text===plan.definition.name) exportsComponent=true;
      if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration)=>ts.isIdentifier(declaration.name) && declaration.name.text===plan.definition.name && declaration.initializer)) exportsComponent=true;
    }
  }
  if (!exportsComponent) throw new Error('Planned component export is not implemented in the bound library');
  let compilerOptions:ts.CompilerOptions={jsx:ts.JsxEmit.ReactJSX,moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext};
  const config=ts.readConfigFile(join(root,'tsconfig.json'),ts.sys.readFile);
  if (!config.error && config.config?.compilerOptions) compilerOptions={...compilerOptions,...ts.convertCompilerOptionsFromJson(config.config.compilerOptions,root).options};
  for (const path of plan.definition.consumers) {
    const file=await boundPath(root,path);
    const source=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
    const aliases=new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue;
      const resolved=ts.resolveModuleName(statement.moduleSpecifier.text,file,compilerOptions,ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved || !inside(plan.library.root,resolved)) continue;
      await boundPath(plan.library.root,resolved);
      const clause=statement.importClause;
      if (clause.name) aliases.add(clause.name.text);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const entry of clause.namedBindings.elements) if ((entry.propertyName?.text ?? entry.name.text)===plan.definition.name) aliases.add(entry.name.text);
      }
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) aliases.add(`${clause.namedBindings.name.text}.${plan.definition.name}`);
    }
    let used=false;
    const visit=(node:ts.Node)=>{
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && aliases.has(node.tagName.getText(source))) used=true;
      ts.forEachChild(node,visit);
    };
    visit(source);
    if (!used) throw new Error(`Consumer does not render the component imported from its product library: ${path}`);
  }
}
