import { readFileSync } from 'node:fs';
import * as ts from 'typescript';

/** A config or script file's syntax tree, read without running it. */
export const parseScript = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);

export const propertyName = (property: ts.ObjectLiteralElementLike): string | undefined =>
  ts.isPropertyAssignment(property) &&
  (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : undefined;

export function objectProperty(
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): ts.Expression | undefined {
  const found = object?.properties.find((property) => propertyName(property) === name);
  return found !== undefined && ts.isPropertyAssignment(found) ? found.initializer : undefined;
}

export const asObject = (
  node: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined =>
  node !== undefined && ts.isObjectLiteralExpression(node) ? node : undefined;

export const asString = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

/** Each value of a property called `name` anywhere in a file: its text when written as a string, else null. */
export function propertyValues(source: ts.SourceFile, name: string): (string | null)[] {
  const values: (string | null)[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && propertyName(node) === name) {
      values.push(asString(node.initializer) ?? null);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

/** The local name a file imports each named export of a module under: `import { route as r }` maps route to r. */
export function importedNames(source: ts.SourceFile, moduleName: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      names.set((element.propertyName ?? element.name).text, element.name.text);
    }
  }
  return names;
}

/** The arguments of each call to a function called `name` anywhere in a file. */
export function callArguments(source: ts.SourceFile, name: string): ts.NodeArray<ts.Expression>[] {
  const calls: ts.NodeArray<ts.Expression>[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls.push(node.arguments);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}
