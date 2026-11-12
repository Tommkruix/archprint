import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import { listSourceFiles, moduleReferences, stringLiterals } from '../scanner/file-walker.js';
import { classifyFile } from '../scanner/role-classifier.js';
import { isSourceFileName } from '../scanner/source-paths.js';
import { findWorkspaceRoot } from '../scanner/workspace-packages.js';
import { type ConfigAliases, aliasesFor, importResolution } from './declared-rules.js';
import { sourceFileFor } from './import-target.js';
import { resolveImportTarget } from './layer-paths.js';

export const CONFIG_FILE = /\.config\.(ts|tsx|js|mjs|cjs|mts|cts)$/;

/** Who references each file under a root the graph reads, by paths from that root. */
export interface ReferenceGraph {
  root: string;
  /** Whether each file is a test, judged on its path from the root or inside its app. */
  tests: ReadonlySet<string>;
  /** Imports of any kind (type-only included), re-exports, `import()` and `require()` calls, and tool configs. */
  referrers: ReadonlyMap<string, ReadonlySet<string>>;
}

/** A file's path inside its app: the deepest tsconfig directory above it. */
function pathInApp(file: string, configs: readonly ConfigAliases[]): string {
  const owner = configs.find(({ dir }) => dir === '' || file.startsWith(`${dir}/`));
  return owner === undefined || owner.dir === '' ? file : file.slice(owner.dir.length + 1);
}

/** Tool configs: those among the source files, and those beside the root and each tsconfig, often `.js` or `.mjs`. */
function toolConfigs(root: string, configs: readonly ConfigAliases[], sources: string[]): string[] {
  const found = new Set(sources.filter((file) => CONFIG_FILE.test(file)));
  for (const dir of new Set(['', ...configs.map((config) => config.dir)])) {
    let names: string[];
    try {
      names = readdirSync(path.join(root, dir));
    } catch {
      /* v8 ignore next -- defensive: a tsconfig directory removed while scanning */
      continue;
    }
    for (const name of names) if (CONFIG_FILE.test(name)) found.add(path.posix.join(dir, name));
  }
  return [...found].sort();
}

const readSafely = (read: () => string[]): string[] => {
  try {
    return read();
  } catch {
    /* v8 ignore next -- defensive: an unreadable or malformed file references nothing */
    return [];
  }
};

const REFERRER_ONLY = /(?<!\.d)\.(js|jsx|mjs|cjs|mts|cts|astro)$/;

/** Files the graph reads: source files, and the JavaScript, `.mts`, `.cts` and Astro files that can import them. */
const readsReferences = (name: string): boolean =>
  isSourceFileName(name) || REFERRER_ONLY.test(name);

/** A path judged as its TypeScript counterpart would be, so `a.test.js` is a test as `a.test.ts` is. */
const asTypeScript = (file: string): string =>
  file.replace(/\.([mc]?js|[mc]ts)$/, '.ts').replace(/\.jsx$/, '.tsx');

const isTest = (file: string): boolean => classifyFile(asTypeScript(file)).role === 'TEST';

interface GraphFile {
  absolutePath: string;
  relativePath: string;
}

/**
 * The files the graph reads: those a scan of `root` reads, and those a scan of any app under it reads, by paths from
 * `root`. An app's scan applies only the ignore files inside it, so it can read a folder a parent ignore file excludes
 * (a tracked `src/lib` under a root `.gitignore` entry `lib`); its files must still count as referrers.
 */
function graphFiles(root: string): GraphFile[] {
  const files = new Map<string, string>();
  for (const dir of [root, ...discoverAppDirs(root)]) {
    for (const absolutePath of listSourceFiles(dir, readsReferences)) {
      if (!files.has(absolutePath)) {
        files.set(absolutePath, path.relative(root, absolutePath).split(path.sep).join('/'));
      }
    }
  }
  return [...files]
    .map(([absolutePath, relativePath]) => ({ absolutePath, relativePath }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Every source file under `root` with the files that reference it, imports resolved first hop the way the scan and
 * the generated rules resolve them: through the importing file's deepest tsconfig aliases and the workspace packages.
 */
export function buildReferenceGraph(root: string): ReferenceGraph {
  const absoluteRoot = path.resolve(root);
  const { configs, packages } = importResolution(absoluteRoot);
  const fileFor = sourceFileFor((candidate) => existsSync(path.join(absoluteRoot, candidate)));
  const resolve = (from: string, specifier: string): string | null =>
    resolveImportTarget(from, specifier, aliasesFor(from, configs), packages, fileFor);

  const walked = graphFiles(absoluteRoot);
  const tests = new Set<string>();
  const referrers = new Map<string, Set<string>>();
  for (const { relativePath } of walked) {
    if (isTest(relativePath) || isTest(pathInApp(relativePath, configs))) tests.add(relativePath);
    referrers.set(relativePath, new Set());
  }
  const refer = (from: string, target: string | null): void => {
    if (target !== null && target !== from) referrers.get(target)?.add(from);
  };
  for (const file of walked) {
    for (const specifier of readSafely(() => moduleReferences(file.absolutePath))) {
      refer(file.relativePath, resolve(file.relativePath, specifier));
    }
  }
  for (const config of toolConfigs(absoluteRoot, configs, [...referrers.keys()])) {
    for (const literal of readSafely(() => stringLiterals(path.join(absoluteRoot, config)))) {
      const specifier = literal.replace(/^<rootDir>\//, './');
      refer(config, resolve(config, specifier.startsWith('.') ? specifier : `./${specifier}`));
    }
  }
  return { root: absoluteRoot, tests, referrers };
}

/** The folder whose files can import an app's files: its workspace root, or the app itself outside a workspace. */
export function referenceRoot(appDir: string): string {
  return findWorkspaceRoot(path.resolve(appDir));
}

export type ReferenceGraphs = (appDir: string) => ReferenceGraph;

/** The reference graph of each app's workspace, built on first use, so the apps one command scans share one graph. */
export function referenceGraphs(): ReferenceGraphs {
  const built = new Map<string, ReferenceGraph>();
  return (appDir) => {
    const root = referenceRoot(appDir);
    let graph = built.get(root);
    if (graph === undefined) {
      graph = buildReferenceGraph(root);
      built.set(root, graph);
    }
    return graph;
  };
}
