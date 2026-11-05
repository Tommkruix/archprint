import * as ts from 'typescript';
import { readSource } from './file-walker.js';

/** A global a file reads: `usage` as the rule names it (`fetch`, `process.env`), at a 1-based line. */
export interface GlobalReference {
  usage: string;
  line: number;
}

interface Usage {
  usage: string;
  name: string;
  member: string | null;
}

const toUsage = (usage: string): Usage => {
  const [name, member] = usage.split('.');
  return { usage, name: name!, member: member ?? null };
};

type Named = ts.Node & { name?: ts.Node };

/** Where an identifier is a label, an imported name or a JSX tag; `.name` positions are handled by isVariableRead. */
const NON_READ_PARENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.LabeledStatement,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.ContinueStatement,
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.JsxOpeningElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxClosingElement,
]);

/** Whether `node`, a child of `parent`, reads a variable rather than naming a declaration, member, key or label. */
function isVariableRead(node: ts.Identifier, parent: ts.Node): boolean {
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isExportSpecifier(parent)) return (parent.propertyName ?? parent.name) === node;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (ts.isQualifiedName(parent)) return parent.left === node;
  if ((parent as Named).name === node) return false;
  return !NON_READ_PARENTS.has(parent.kind);
}

const isClassExtends = (node: ts.Node, parent: ts.Node | undefined): node is ts.HeritageClause =>
  ts.isHeritageClause(node) &&
  node.token === ts.SyntaxKind.ExtendsKeyword &&
  parent !== undefined &&
  (ts.isClassDeclaration(parent) || ts.isClassExpression(parent));

/** The member a read takes: `x.env` or `x['env']`; null for a bare read or a computed one. */
function memberRead(node: ts.Identifier, parent: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return parent.name.text;
  if (
    ts.isElementAccessExpression(parent) &&
    parent.expression === node &&
    ts.isStringLiteralLike(parent.argumentExpression)
  ) {
    return parent.argumentExpression.text;
  }
  return null;
}

/** Whether a declaration sits in `declare global { ... }`, which declares the global itself, not a local. */
function augmentsGlobal(declaration: ts.Node): boolean {
  for (let node = declaration.parent; node !== undefined; node = node.parent) {
    if (ts.isModuleDeclaration(node) && (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0) {
      return true;
    }
  }
  return false;
}

const SINGLE_FILE_OPTIONS: ts.CompilerOptions = {
  noLib: true,
  noResolve: true,
  types: [],
  jsx: ts.JsxEmit.Preserve,
};

/**
 * A type checker over one file and nothing else, so a name resolves only through the file's own scopes: one it
 * does not bind there has no declaration, as a global has none without the standard library loaded.
 */
function singleFileChecker(
  absoluteFilePath: string,
  source: string,
  scriptKind: ts.ScriptKind,
): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
  const fileName = /\.tsx?$/.test(absoluteFilePath) ? absoluteFilePath : `${absoluteFilePath}.ts`;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const host = ts.createCompilerHost(SINGLE_FILE_OPTIONS);
  host.getSourceFile = (requested) => (requested === fileName ? sourceFile : undefined);
  const program = ts.createProgram({ rootNames: [fileName], options: SINGLE_FILE_OPTIONS, host });
  return { sourceFile, checker: program.getTypeChecker() };
}

/**
 * Where a file reads each of `usages` as a global: a bare name (`fetch`) or a name and member (`process.env`, read
 * as `.env` or `['env']`). A read counts only when the name does not resolve, through the scopes around it, to a
 * value the file declares (an import, variable, parameter, function, class, enum or namespace), the way TypeScript
 * and typescript-eslint's scope analysis resolve a reference; `declare global` declares the global itself. Reads in
 * type positions do not count; `typeof x` does.
 */
export function globalReferences(
  absoluteFilePath: string,
  usages: readonly string[],
): GlobalReference[] {
  const wanted = usages.map(toUsage);
  const names = new Set(wanted.map((usage) => usage.name));
  const { source, scriptKind } = readSource(absoluteFilePath);
  if (![...names].some((name) => source.includes(name))) return [];
  const { sourceFile, checker } = singleFileChecker(absoluteFilePath, source, scriptKind);
  const declaredInFile = (node: ts.Identifier): boolean =>
    checker
      .resolveName(node.text, node, ts.SymbolFlags.Value, false)
      ?.declarations?.some(
        (declaration) => declaration.getSourceFile() === sourceFile && !augmentsGlobal(declaration),
      ) ?? false;

  const references: GlobalReference[] = [];
  const record = (node: ts.Identifier, parent: ts.Node): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const member = memberRead(node, parent);
    for (const usage of wanted) {
      if (usage.name === node.text && (usage.member === null || usage.member === member)) {
        references.push({ usage: usage.usage, line });
      }
    }
  };

  function visit(node: ts.Node, parent: ts.Node | undefined, inType: boolean): void {
    if (
      ts.isIdentifier(node) &&
      parent !== undefined &&
      !inType &&
      names.has(node.text) &&
      isVariableRead(node, parent) &&
      !declaredInFile(node)
    ) {
      record(node, parent);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) return;
    if (ts.isTypeQueryNode(node)) {
      visitValue(node.exprName, node, node.typeArguments);
      return;
    }
    if (isClassExtends(node, parent)) {
      for (const type of node.types) visitValue(type.expression, type, type.typeArguments);
      return;
    }
    const nested = inType || ts.isTypeNode(node);
    ts.forEachChild(node, (child) => visit(child, node, nested));
  }

  function visitValue(
    value: ts.Node,
    owner: ts.Node,
    typeArguments: readonly ts.TypeNode[] | undefined,
  ): void {
    visit(value, owner, false);
    for (const type of typeArguments ?? []) visit(type, owner, true);
  }

  visit(sourceFile, undefined, false);
  return references;
}
