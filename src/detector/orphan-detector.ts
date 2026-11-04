import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import {
  moduleReferences,
  stringLiterals,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import { buildAliasEntries } from '../scanner/import-graph.js';
import { resolveFirstPartyImport } from '../scanner/resolve-import.js';
import { REQUEST_ENTRY_ROLES } from './pattern-detector.js';
import { STORY } from './stories-isolation-detector.js';

const ENTRY_FILENAME =
  /(^|\/)(page|layout|loading|error|not-found|template|default|route|middleware|instrumentation|global-error|_app|_document|index)\.(ts|tsx)$/;
/** Next.js metadata and special files, which the framework loads from the app directory by name. */
const NEXT_APP_FILE =
  /(^|\/)app\/(.*\/)?(robots|sitemap|manifest|opengraph-image|twitter-image|icon|apple-icon|global-not-found|forbidden|unauthorized)\.(ts|tsx)$/;
const NEXT_ROOT_FILE = /^(src\/)?(instrumentation-client|proxy)\.(ts|tsx)$/;
const CONFIG_FILE = /\.config\.(ts|tsx|js|mjs|cjs|mts|cts)$/;

function isEntry(file: WalkedFile): boolean {
  return (
    REQUEST_ENTRY_ROLES.includes(file.role) ||
    file.role === 'ROUTE_ENTRY' ||
    [ENTRY_FILENAME, NEXT_APP_FILE, NEXT_ROOT_FILE, CONFIG_FILE, STORY].some((entry) =>
      entry.test(file.relativePath),
    )
  );
}

export interface OrphanAnalysis {
  appDir: string;
  fileCount: number;
  /** Production files nothing imports. */
  orphans: string[];
  /** Production files only tests import: dead code the tests keep alive. */
  testOnly: string[];
}

/** The tool configs at the app root and among its source files, whose string literals name setup files. */
function configFiles(root: string, files: readonly WalkedFile[]): string[] {
  const atRoot = readdirSync(root).filter((name) => CONFIG_FILE.test(name));
  return [
    ...new Set([
      ...atRoot.map((name) => path.join(root, name)),
      ...files.filter((file) => CONFIG_FILE.test(file.relativePath)).map((f) => f.absolutePath),
    ]),
  ];
}

/**
 * Files nothing references, and files only tests reference. A reference is any import, type-only included, an
 * `export ... from` or `import()`, or a tool config naming the file (`setupFiles: ['./vitest.setup.ts']`).
 */
export function detectOrphans(appDir: string): OrphanAnalysis {
  const root = path.resolve(appDir);
  const files = walkRepo(root);
  const relByAbs = new Map(files.map((file) => [file.absolutePath, file.relativePath]));
  const aliases = buildAliasEntries(root);
  const referrers = new Map<string, Set<string>>(
    files.map((file) => [file.relativePath, new Set()]),
  );
  const refer = (from: string, specifier: string, fromAbsPath: string): void => {
    const target = resolveFirstPartyImport(specifier, fromAbsPath, aliases);
    const rel = target === null ? undefined : relByAbs.get(target);
    if (rel !== undefined && rel !== from) referrers.get(rel)!.add(from);
  };
  for (const file of files) {
    let specifiers: string[];
    try {
      specifiers = moduleReferences(file.absolutePath);
    } catch {
      /* v8 ignore next -- defensive: an unreadable or malformed file references nothing */
      specifiers = [];
    }
    for (const specifier of specifiers) refer(file.relativePath, specifier, file.absolutePath);
  }
  for (const config of configFiles(root, files)) {
    const from = path.relative(root, config).split(path.sep).join('/');
    for (const literal of stringLiterals(config)) {
      const specifier = literal.replace(/^<rootDir>\//, './');
      refer(from, specifier.startsWith('.') ? specifier : `./${specifier}`, config);
    }
  }

  const isTest = new Set(files.filter((file) => file.role === 'TEST').map((f) => f.relativePath));
  const production = files.filter((file) => file.role !== 'TEST');
  const orphans: string[] = [];
  const testOnly: string[] = [];
  for (const file of production) {
    if (isEntry(file)) continue;
    const from = [...referrers.get(file.relativePath)!];
    if (from.length === 0) orphans.push(file.relativePath);
    else if (from.every((referrer) => isTest.has(referrer))) testOnly.push(file.relativePath);
  }
  return {
    appDir: root,
    fileCount: production.length,
    orphans: orphans.sort(),
    testOnly: testOnly.sort(),
  };
}
