import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { walkRepo, type WalkedFile } from '../scanner/file-walker.js';
import { declaredPackages } from '../scanner/package-name.js';
import { findWorkspaceRoot } from '../scanner/workspace-packages.js';
import { packageEntriesUnder } from './package-entries.js';
import { REQUEST_ENTRY_ROLES } from './pattern-detector.js';
import { CONFIG_FILE, type ReferenceGraphs, referenceGraphs } from './reference-graph.js';
import { STORY } from './stories-isolation-detector.js';

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

const NEXT_CONFIG = /^next\.config\.(js|mjs|cjs|ts|mts)$/;
const PAGES_DIR = /^(src\/)?pages\//;

function declaresNext(dir: string): boolean {
  try {
    return declaredPackages(readFileSync(path.join(dir, 'package.json'), 'utf8')).includes('next');
  } catch {
    return false;
  }
}

/**
 * Whether a file under `root` is a Next.js pages-router page, which the framework routes by its path: its path from
 * a Next.js project starts with `pages/` or `src/pages/`. A project is a folder holding a `next.config.*`, or a
 * package whose package.json or workspace root declares `next`.
 */
export function nextPagesUnder(root: string): (relativePath: string) => boolean {
  const projects = new Map<string, boolean>();
  const isProject = (dir: string): boolean => {
    let known = projects.get(dir);
    if (known === undefined) {
      const absolute = path.join(root, dir);
      let names: string[];
      try {
        names = readdirSync(absolute);
      } catch {
        /* v8 ignore next -- defensive: a folder removed while scanning */
        names = [];
      }
      known =
        names.some((name) => NEXT_CONFIG.test(name)) ||
        (names.includes('package.json') &&
          (declaresNext(absolute) || declaresNext(findWorkspaceRoot(absolute))));
      projects.set(dir, known);
    }
    return known;
  };
  return (relativePath) => {
    for (let dir = path.posix.dirname(relativePath); ; dir = path.posix.dirname(dir)) {
      const project = dir === '.' ? '' : dir;
      const inside = project === '' ? relativePath : relativePath.slice(project.length + 1);
      if (PAGES_DIR.test(inside) && isProject(project)) return true;
      if (project === '') return false;
    }
  };
}

export interface OrphanAnalysis {
  appDir: string;
  fileCount: number;
  /** Production files nothing imports. */
  orphans: string[];
  /** Production files only tests import: dead code the tests keep alive. */
  testOnly: string[];
}

/**
 * Files nothing in the repository references, and files only tests reference. A reference is any import, type-only
 * included, an `export ... from` or `import()`, a `require()`, or a tool config naming the file
 * (`setupFiles: ['./vitest.setup.ts']`), from any file of the app's workspace, each resolved through its own tsconfig.
 */
export function detectOrphans(
  appDir: string,
  options: { references?: ReferenceGraphs } = {},
): OrphanAnalysis {
  const root = path.resolve(appDir);
  const files = walkRepo(root);
  const nextPage = nextPagesUnder(root);
  const packageEntries = packageEntriesUnder(
    root,
    files.map((file) => file.relativePath),
  );
  const graph = (options.references ?? referenceGraphs())(root);
  const prefix = path.relative(graph.root, root).split(path.sep).join('/');
  const inGraph = (file: string): string => (prefix === '' ? file : `${prefix}/${file}`);

  const production = files.filter((file) => file.role !== 'TEST');
  const orphans: string[] = [];
  const testOnly: string[] = [];
  for (const file of production) {
    if (isEntry(file) || nextPage(file.relativePath) || packageEntries.has(file.relativePath)) {
      continue;
    }
    const referrers = graph.referrers.get(inGraph(file.relativePath));
    if (referrers === undefined) continue;
    if (referrers.size === 0) orphans.push(file.relativePath);
    else if ([...referrers].every((referrer) => graph.tests.has(referrer))) {
      testOnly.push(file.relativePath);
    }
  }
  return {
    appDir: root,
    fileCount: production.length,
    orphans: orphans.sort(),
    testOnly: testOnly.sort(),
  };
}
