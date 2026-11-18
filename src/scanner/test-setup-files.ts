import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { pathFromFolder } from './computed-paths.js';
import { asString, parseScript, propertyName } from './config-literals.js';
import { firstPartyCandidates } from './resolve-import.js';

const TEST_RUNNER_CONFIG =
  /^(?:(?:vitest|vite|jest|playwright)\.config|vitest\.(?:workspace|projects))\.[cm]?[jt]s$/;

/** A file that can name test setup files: a vitest, vite, jest or playwright config, or a package.json (`jest`). */
export const namesTestSetup = (name: string): boolean =>
  TEST_RUNNER_CONFIG.test(name) || name === 'package.json';

/** The options vitest, jest and playwright take to run a file before, around or after the tests. */
const SETUP_KEYS: ReadonlySet<string> = new Set([
  'setupFiles',
  'setupFilesAfterEnv',
  'globalSetup',
  'globalTeardown',
]);

const toPosix = (value: string): string => value.split(path.sep).join('/');

const isFile = (candidate: string): boolean =>
  statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false;

/** A path as the config writes it, from the config's folder: `<rootDir>/x`, `./x`, `x` or `path.resolve(__dirname, 'x')`. */
function writtenPath(node: ts.Expression, source: ts.SourceFile): string | null {
  const text = asString(node);
  if (text === undefined) return pathFromFolder(node, source);
  return text.replace(/^<rootDir>\//, './');
}

function scriptSetupPaths(file: string): string[] {
  let source: ts.SourceFile;
  try {
    source = parseScript(file);
  } catch {
    return [];
  }
  const paths: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && SETUP_KEYS.has(propertyName(node) ?? '')) {
      const values = ts.isArrayLiteralExpression(node.initializer)
        ? node.initializer.elements
        : [node.initializer];
      for (const value of values) {
        const written = writtenPath(value, source);
        if (written !== null) paths.push(written);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return paths;
}

function manifestSetupPaths(file: string): string[] {
  let jest: unknown;
  try {
    jest = (JSON.parse(readFileSync(file, 'utf8')) as { jest?: unknown }).jest;
  } catch {
    return [];
  }
  if (typeof jest !== 'object' || jest === null) return [];
  return Object.entries(jest)
    .filter(([key]) => SETUP_KEYS.has(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/^<rootDir>\//, './'));
}

/**
 * The source files a test runner config names to run around the tests (vitest and jest `setupFiles`, jest
 * `setupFilesAfterEnv`, `globalSetup` and `globalTeardown` in any of them and in playwright): test code, though no
 * test path names them. `configs` are the files `namesTestSetup` accepts, and every path is from `root`.
 */
export function testSetupFiles(root: string, configs: readonly string[]): Set<string> {
  const files = new Set<string>();
  for (const config of configs) {
    const file = path.join(root, config);
    const written =
      path.basename(config) === 'package.json' ? manifestSetupPaths(file) : scriptSetupPaths(file);
    for (const entry of written) {
      const found = firstPartyCandidates(path.resolve(path.dirname(file), entry)).find(isFile);
      if (found !== undefined) files.add(toPosix(path.relative(root, found)));
    }
  }
  return files;
}
