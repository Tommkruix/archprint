import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import {
  listSourceFiles,
  type ModuleLoader,
  moduleLoaders,
  moduleReferences,
  stringLiterals,
} from '../scanner/file-walker.js';
import { classifyFile } from '../scanner/role-classifier.js';
import { namesTestSetup, testSetupFiles } from '../scanner/test-setup-files.js';
import { isSourceFileName } from '../scanner/source-paths.js';
import { findWorkspaceRoot } from '../scanner/workspace-packages.js';
import { type ConfigAliases, aliasesFor, importResolution } from './declared-rules.js';
import { sourceFileFor } from './import-target.js';
import { resolveImportTarget } from './layer-paths.js';
import { type MetroPlatform, metroFileFor, metroPlatformsUnder } from './metro-platforms.js';
import { createViteProjects, createViteRoots, loadedFiles } from './module-loaders.js';

export const CONFIG_FILE = /\.config\.(ts|tsx|js|mjs|cjs|mts|cts)$/;

/** Who references each file under a root the graph reads, by paths from that root. */
export interface ReferenceGraph {
  root: string;
  /** Whether each file is a test, judged on its path from the root or inside its app. */
  tests: ReadonlySet<string>;
  /**
   * Imports of any kind (type-only included), re-exports, `import()` and `require()` calls, `import.meta.glob` and
   * `require.context` loaders, tool configs, and a workspace package's package.json for each subpath it exports.
   */
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

const readLoaders = (file: string): ModuleLoader[] => {
  try {
    return moduleLoaders(file);
  } catch {
    /* v8 ignore next -- defensive: an unreadable or malformed file loads nothing */
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
function graphFiles(root: string, accepts: (name: string) => boolean): GraphFile[] {
  const files = new Map<string, string>();
  for (const dir of [root, ...discoverAppDirs(root)]) {
    for (const absolutePath of listSourceFiles(dir, accepts)) {
      if (!files.has(absolutePath)) {
        files.set(absolutePath, path.relative(root, absolutePath).split(path.sep).join('/'));
      }
    }
  }
  return [...files]
    .map(([absolutePath, relativePath]) => ({ absolutePath, relativePath }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** The module an import names without its bundler query (`./theme?raw`, `./worker.js?worker&url`). */
const withoutQuery = (specifier: string): string => {
  const query = specifier.indexOf('?');
  return query > 0 ? specifier.slice(0, query) : specifier;
};

/**
 * Every source file under `root` with the files that reference it, imports resolved first hop the way the scan and
 * the generated rules resolve them (through the importing file's deepest tsconfig aliases, its package.json `imports`
 * and the workspace packages), without a bundler query. Each subpath a workspace package exports counts as an import
 * of `<name>/<subpath>` from its package.json, so the repo's own tsconfig `paths` say which source file it is.
 */
export function buildReferenceGraph(root: string): ReferenceGraph {
  const absoluteRoot = path.resolve(root);
  const { configs, packages, scopes } = importResolution(absoluteRoot);
  const fileFor = sourceFileFor((candidate) => existsSync(path.join(absoluteRoot, candidate)));
  const resolve = (from: string, specifier: string): string | null =>
    resolveImportTarget(from, specifier, aliasesFor(from, configs), packages, scopes, fileFor);
  const files = new Map<string, boolean>();
  const isFile = (candidate: string): boolean => {
    let known = files.get(candidate);
    if (known === undefined) {
      known =
        statSync(path.join(absoluteRoot, candidate), { throwIfNoEntry: false })?.isFile() === true;
      files.set(candidate, known);
    }
    return known;
  };
  const platformsOf = metroPlatformsUnder(absoluteRoot);
  const platformFileFor = new Map<MetroPlatform, (base: string) => string | null>();
  const fileOnPlatform = (platform: MetroPlatform): ((base: string) => string | null) => {
    let found = platformFileFor.get(platform);
    if (found === undefined) {
      found = metroFileFor(isFile, platform);
      platformFileFor.set(platform, found);
    }
    return found;
  };
  /** What an import resolves to as TypeScript reads it, and, in a React Native project, on each platform Metro builds. */
  const targets = (from: string, specifier: string): (string | null)[] => [
    resolve(from, specifier),
    ...platformsOf(from).map((platform) =>
      resolveImportTarget(
        from,
        specifier,
        aliasesFor(from, configs),
        packages,
        scopes,
        fileOnPlatform(platform),
      ),
    ),
  ];

  const listed = graphFiles(absoluteRoot, (name) => readsReferences(name) || namesTestSetup(name));
  const named = (accepts: (name: string) => boolean): GraphFile[] =>
    listed.filter((file) => accepts(path.basename(file.relativePath)));
  const walked = named(readsReferences);
  const setupFiles = testSetupFiles(
    absoluteRoot,
    named(namesTestSetup).map((file) => file.relativePath),
  );
  const tests = new Set<string>();
  const referrers = new Map<string, Set<string>>();
  for (const { relativePath } of walked) {
    if (
      setupFiles.has(relativePath) ||
      isTest(relativePath) ||
      isTest(pathInApp(relativePath, configs))
    ) {
      tests.add(relativePath);
    }
    referrers.set(relativePath, new Set());
  }
  const refer = (from: string, target: string | null): void => {
    if (target !== null && target !== from) referrers.get(target)?.add(from);
  };
  for (const file of walked) {
    for (const specifier of readSafely(() => moduleReferences(file.absolutePath))) {
      for (const target of targets(file.relativePath, withoutQuery(specifier))) {
        refer(file.relativePath, target);
      }
    }
  }
  const sources = [...referrers.keys()];
  const viteRootOf = createViteRoots(absoluteRoot);
  const bundledByVite = createViteProjects(absoluteRoot);
  for (const file of walked) {
    for (const loader of readLoaders(file.absolutePath)) {
      const aliases = aliasesFor(file.relativePath, configs);
      for (const target of loadedFiles(
        loader,
        file.relativePath,
        sources,
        aliases,
        viteRootOf(file.relativePath),
        bundledByVite(file.relativePath),
      )) {
        refer(file.relativePath, target);
      }
    }
  }
  for (const config of toolConfigs(absoluteRoot, configs, sources)) {
    for (const literal of readSafely(() => stringLiterals(path.join(absoluteRoot, config)))) {
      const specifier = literal.replace(/^<rootDir>\//, './');
      refer(config, resolve(config, specifier.startsWith('.') ? specifier : `./${specifier}`));
    }
  }
  for (const { name, dir, subpaths } of packages) {
    const manifest = `${dir}/package.json`;
    for (const { key, targets: written } of subpaths) {
      if (written.length === 0) continue;
      for (const target of targets(manifest, `${name}${key.slice(1)}`)) refer(manifest, target);
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
