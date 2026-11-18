import * as path from 'node:path';
import * as ts from 'typescript';

/** Stands for a part of a path known only at runtime while the path is normalized. */
const HOLE = '\u0000';

const isImportMetaProperty = (node: ts.Node, name: string): boolean =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === name &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;

/** A string literal's text, a template's text with a hole for each `${...}`; null for anything else. */
function writtenPath(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return node.head.text + node.templateSpans.map((span) => HOLE + span.literal.text).join('');
}

const isDirname = (node: ts.Expression): boolean =>
  (ts.isIdentifier(node) && node.text === '__dirname') || isImportMetaProperty(node, 'dirname');

/** The initializer of the one `const` in the file with this name; undefined when there is none or several. */
function constInitializer(
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

/**
 * A path a file builds from its own folder, `path.join(__dirname, 'tasks', `${name}.ts`)` or `path.resolve(...)` with
 * `import.meta.dirname`, as `./tasks/<hole>.ts`; an argument that is not written out is a hole. Followed through a
 * `const` and `pathToFileURL(...).href`. Null for any other expression.
 */
function folderPath(node: ts.Expression, sourceFile: ts.SourceFile, depth = 0): string | null {
  if (depth > 4) return null;
  if (ts.isIdentifier(node)) {
    const initializer = constInitializer(node, sourceFile);
    return initializer === undefined ? null : folderPath(initializer, sourceFile, depth + 1);
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'href' &&
    ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'pathToFileURL' &&
    node.expression.arguments[0] !== undefined
  ) {
    return folderPath(node.expression.arguments[0], sourceFile, depth + 1);
  }
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    !['join', 'resolve'].includes(node.expression.name.text)
  ) {
    return null;
  }
  const [first, ...rest] = node.arguments;
  if (first === undefined || !isDirname(first)) return null;
  const segments = rest.map((argument) => writtenPath(argument) ?? HOLE);
  if (
    node.expression.name.text === 'resolve' &&
    segments.some((segment) => segment.startsWith('/'))
  ) {
    return null;
  }
  const joined = path.posix.join('.', ...segments);
  return joined.startsWith('.') ? joined : `./${joined}`;
}

/**
 * The parts around each runtime hole of a path a file loads by a path it computes: an `import()` or `require()` of a
 * template literal or of a path built from the file's folder, or `new URL(path, import.meta.url)` (Vite and webpack
 * bundle the file it names). One part when the path has no hole; null when the node loads no such path.
 */
export function computedPath(node: ts.Node, sourceFile: ts.SourceFile): string[] | null {
  let written: string | null = null;
  if (ts.isCallExpression(node) && node.arguments[0] !== undefined) {
    const loads =
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require');
    const [argument] = node.arguments;
    if (loads) {
      written = ts.isTemplateExpression(argument)
        ? writtenPath(argument)
        : folderPath(argument, sourceFile);
    }
  }
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'URL' &&
    node.arguments?.length === 2 &&
    isImportMetaProperty(node.arguments[1]!, 'url')
  ) {
    const url = writtenPath(node.arguments[0]!);
    written = url !== null && url.startsWith('.') ? url : null;
  }
  return written === null ? null : written.split(HOLE);
}
