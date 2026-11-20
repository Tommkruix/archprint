import * as path from 'node:path';
import { walkRepo, type WalkedFile } from '../scanner/file-walker.js';
import { frameworkFilesUnder } from './file-routes.js';
import { packageEntriesUnder } from './package-entries.js';
import { REQUEST_ENTRY_ROLES } from './pattern-detector.js';
import { CONFIG_FILE, type ReferenceGraphs, referenceGraphs } from './reference-graph.js';
import { STORY } from './stories-isolation-detector.js';
import { viteEntriesUnder } from './vite-entries.js';

const ENTRY_FILENAME =
  /(^|\/)(page|layout|loading|error|not-found|template|default|route|middleware|instrumentation|global-error|_app|_document|index)\.(ts|tsx)$/;
/** Next.js metadata and special files, which the framework loads from the app directory by name. */
const NEXT_APP_FILE =
  /(^|\/)app\/(.*\/)?(robots|sitemap|manifest|opengraph-image|twitter-image|icon|apple-icon|global-not-found|forbidden|unauthorized)\.(ts|tsx)$/;
const NEXT_ROOT_FILE = /^(src\/)?(instrumentation-client|proxy)\.(ts|tsx)$/;

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
  /**
   * Production files nothing but tests imports that a published package without `exports` ships, so its users may
   * import them by path: neither listed as dead nor known to be used.
   */
  shipped: string[];
}

/**
 * Files nothing in the repository references, and files only tests reference. A reference is any import, type-only
 * included, an `export ... from` or `import()`, a `require()`, a literal `import.meta.glob` or `require.context`, or a
 * tool config naming the file (`setupFiles: ['./vitest.setup.ts']`), from any file of the app's workspace, each
 * resolved through its own tsconfig.
 */
export function detectOrphans(
  appDir: string,
  options: { references?: ReferenceGraphs } = {},
): OrphanAnalysis {
  const root = path.resolve(appDir);
  const files = walkRepo(root);
  const frameworkFile = frameworkFilesUnder(root);
  const packageEntries = packageEntriesUnder(
    root,
    files.map((file) => file.relativePath),
  );
  const viteEntries = viteEntriesUnder(root);
  const graph = (options.references ?? referenceGraphs())(root);
  const prefix = path.relative(graph.root, root).split(path.sep).join('/');
  const inGraph = (file: string): string => (prefix === '' ? file : `${prefix}/${file}`);

  const production = files.filter((file) => file.role !== 'TEST');
  const orphans: string[] = [];
  const testOnly: string[] = [];
  const shipped: string[] = [];
  for (const file of production) {
    if (
      isEntry(file) ||
      frameworkFile(file.relativePath) ||
      packageEntries.has(file.relativePath) ||
      viteEntries.has(file.relativePath)
    ) {
      continue;
    }
    const referrers = graph.referrers.get(inGraph(file.relativePath));
    if (referrers === undefined) continue;
    const unused = referrers.size === 0;
    if (!unused && ![...referrers].every((referrer) => graph.tests.has(referrer))) continue;
    if (graph.shipped.has(inGraph(file.relativePath))) shipped.push(file.relativePath);
    else (unused ? orphans : testOnly).push(file.relativePath);
  }
  return {
    appDir: root,
    fileCount: production.length,
    orphans: orphans.sort(),
    testOnly: testOnly.sort(),
    shipped: shipped.sort(),
  };
}
