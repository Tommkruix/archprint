import * as path from 'node:path';
import * as ts from 'typescript';
import { constInitializer, importedNames } from './config-literals.js';

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

const PATH_MODULES = ['path', 'node:path'];

/** The `join` or `resolve` a call makes: `path.join(...)`, or `resolve(...)` imported by name from `path`. */
function pathFunction(call: ts.CallExpression, sourceFile: ts.SourceFile): string | undefined {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    return ['join', 'resolve'].includes(callee.name.text) ? callee.name.text : undefined;
  }
  if (!ts.isIdentifier(callee)) return undefined;
  return ['join', 'resolve'].find((name) =>
    PATH_MODULES.some((module) => importedNames(sourceFile, module).get(name) === callee.text),
  );
}

/** The relative path `L` of `fileURLToPath(new URL(L, import.meta.url))`; null for anything else. */
function fileUrlPath(node: ts.Expression): string | null {
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== 'fileURLToPath'
  ) {
    return null;
  }
  const [url] = node.arguments;
  const relative = url === undefined ? null : urlPath(url);
  return relative === null || relative.includes(HOLE) ? null : relative;
}

/** The relative path written in `new URL(path, import.meta.url)`, a hole for each `${...}`; null for anything else. */
function urlPath(node: ts.Expression): string | null {
  if (
    !ts.isNewExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== 'URL' ||
    node.arguments?.length !== 2 ||
    !isImportMetaProperty(node.arguments[1]!, 'url')
  ) {
    return null;
  }
  const written = writtenPath(node.arguments[0]!);
  return written !== null && written.startsWith('.') ? written : null;
}

const fromFolder = (segments: readonly string[]): string => {
  const joined = path.posix.join('.', ...segments);
  return joined.startsWith('.') ? joined : `./${joined}`;
};

/**
 * A path a file builds from its own folder, `path.join(__dirname, 'tasks', `${name}.ts`)` or `resolve(...)` with
 * `import.meta.dirname`, as `./tasks/<hole>.ts`; an argument that is not written out is a hole. Also `__dirname`
 * itself and `fileURLToPath(new URL('./x', import.meta.url))`; followed through a `const` and
 * `pathToFileURL(...).href`. Null for any other expression.
 */
function folderPath(node: ts.Expression, sourceFile: ts.SourceFile, depth = 0): string | null {
  if (depth > 4) return null;
  if (isDirname(node)) return '.';
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
  const fileUrl = fileUrlPath(node);
  if (fileUrl !== null) return fromFolder([fileUrl]);
  const operation = ts.isCallExpression(node) ? pathFunction(node, sourceFile) : undefined;
  if (operation === undefined || !ts.isCallExpression(node)) return null;
  const [first, ...rest] = node.arguments;
  if (first === undefined || !isDirname(first)) return null;
  const segments = rest.map((argument) => writtenPath(argument) ?? HOLE);
  if (operation === 'resolve' && segments.some((segment) => segment.startsWith('/'))) return null;
  return fromFolder(segments);
}

/**
 * A path a file names from its own folder with nothing left to runtime (`__dirname`, `resolve(__dirname, 'src')`,
 * `fileURLToPath(new URL('./src', import.meta.url))`), as `./src`; null for anything else.
 */
export function pathFromFolder(node: ts.Expression, sourceFile: ts.SourceFile): string | null {
  const written = folderPath(node, sourceFile);
  return written === null || written.includes(HOLE) ? null : written;
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
  if (ts.isNewExpression(node)) written = urlPath(node);
  return written === null ? null : written.split(HOLE);
}
