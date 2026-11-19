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

/** The value an object literal gives a property: its initializer, or the variable a shorthand `{ name }` names. */
export function objectProperty(
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): ts.Expression | undefined {
  for (const property of object?.properties ?? []) {
    if (ts.isPropertyAssignment(property) && propertyName(property) === name) {
      return property.initializer;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
      return property.name;
    }
  }
  return undefined;
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
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === name) values.push(null);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

const isRequireOf = (node: ts.Expression | undefined, moduleName: string): boolean =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'require' &&
  node.arguments.length === 1 &&
  asString(node.arguments[0]) === moduleName;

/**
 * The local name a file imports each named export of a module under: `import { route as r }` and
 * `const { route: r } = require(...)` map route to r.
 */
export function importedNames(source: ts.SourceFile, moduleName: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isObjectBindingPattern(declaration.name) ||
          !isRequireOf(declaration.initializer, moduleName)
        ) {
          continue;
        }
        for (const element of declaration.name.elements) {
          const exported = element.propertyName ?? element.name;
          if (ts.isIdentifier(exported) && ts.isIdentifier(element.name)) {
            names.set(exported.text, element.name.text);
          }
        }
      }
      continue;
    }
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

/** The local name a file gives a module's default export: `import x from 'm'` or `const x = require('m')`. */
export function defaultImportName(source: ts.SourceFile, moduleName: string): string | undefined {
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName &&
      statement.importClause?.name !== undefined
    ) {
      return statement.importClause.name.text;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isRequireOf(declaration.initializer, moduleName)) {
          return declaration.name.text;
        }
      }
    }
  }
  return undefined;
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

/** The initializer of the one `const` in the file with this name; undefined when there is none or several. */
export function constInitializer(
  name: ts.Identifier,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const) !== 0) {
      for (const declaration of node.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name.text &&
          declaration.initializer !== undefined
        ) {
          found.push(declaration.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found.length === 1 ? found[0] : undefined;
}

const unwrapped = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isAwaitExpression(node)
    ? unwrapped(node.expression)
    : node;

/** The expressions a function body returns, not those of functions nested in it. */
function returnedExpressions(body: ts.ConciseBody): ts.Expression[] {
  if (!ts.isBlock(body)) return [body];
  const returned: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) returned.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return returned;
}

function objectsIn(
  node: ts.Expression,
  source: ts.SourceFile,
  depth: number,
): ts.ObjectLiteralExpression[] {
  if (depth > 4) return [];
  const expression = unwrapped(node);
  if (ts.isObjectLiteralExpression(expression)) return [expression];
  const next = (inner: ts.Expression): ts.ObjectLiteralExpression[] =>
    objectsIn(inner, source, depth + 1);
  if (ts.isIdentifier(expression)) {
    const initializer = constInitializer(expression, source);
    return initializer === undefined ? [] : next(initializer);
  }
  if (ts.isCallExpression(expression)) return expression.arguments.flatMap(next);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return returnedExpressions(expression.body).flatMap(next);
  }
  return [];
}

const isModuleExports = (node: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'module' &&
  node.name.text === 'exports';

/**
 * The object literals a config file exports as its config: its `export default` or `module.exports` value, through
 * calls such as `defineConfig(...)`, functions returning an object, and a single `const`.
 */
export function configObjects(source: ts.SourceFile): ts.ObjectLiteralExpression[] {
  return source.statements.flatMap((statement) => {
    if (ts.isExportAssignment(statement)) return objectsIn(statement.expression, source, 0);
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isModuleExports(statement.expression.left)
    ) {
      return objectsIn(statement.expression.right, source, 0);
    }
    return [];
  });
}
