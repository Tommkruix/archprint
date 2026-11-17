import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { isSourceFileName } from './source-paths.js';
import { svelteKitAliases } from './sveltekit.js';

function ownPackageName(rootDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    return typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : null;
  } catch {
    /* v8 ignore next -- no/unreadable package.json: nothing to self-alias */
    return null;
  }
}

function parseConfig(configPath: string): ts.ParsedCommandLine | null {
  if (!ts.sys.fileExists(configPath)) return null;
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readResult.error !== undefined) return null;
  return ts.parseJsonConfigFileContent(readResult.config, ts.sys, path.dirname(configPath));
}

/** Whether `dir` holds the tsconfig.json nearest to `file`, the config TypeScript looks at first. */
function isNearestConfigDir(dir: string, file: string): boolean {
  const relative = path.relative(dir, path.dirname(file));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return false;
  }
  const segments = relative === '' ? [] : relative.split(path.sep);
  return !segments.some((_, depth) =>
    ts.sys.fileExists(path.join(dir, ...segments.slice(0, depth + 1), 'tsconfig.json')),
  );
}

interface TsProject {
  configPath: string;
  config: ts.ParsedCommandLine;
}

interface OwningProjects {
  /** The directory's tsconfig.json; null when variants configure it instead. */
  root: TsProject | null;
  /** The configs beside it that compile files of the directory: the root's direct references, or the variants. */
  peers: TsProject[];
}

function readProject(configPath: string): TsProject | null {
  const config = parseConfig(configPath);
  return config === null ? null : { configPath, config };
}

const BASE_CONFIG = 'tsconfig.base.json';

const isVariantConfig = (name: string): boolean =>
  /^tsconfig\..+\.json$/.test(name) && name !== BASE_CONFIG;

/**
 * The tsconfig files that configure `dir`: its tsconfig.json; in a folder with neither tsconfig.json nor
 * tsconfig.base.json, the `tsconfig.*.json` files beside it by name, the configs its builds name
 * (`tsc -p tsconfig.web.json`, or a setup script that copies one to tsconfig.json).
 */
export function projectConfigPaths(dir: string): string[] {
  const own = path.join(dir, 'tsconfig.json');
  if (ts.sys.fileExists(own)) return [own];
  if (ts.sys.fileExists(path.join(dir, BASE_CONFIG))) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(isVariantConfig)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => path.join(dir, name));
}

/**
 * The projects TypeScript compiles a directory's files with: its tsconfig.json, and each project it references that
 * includes a file whose nearest tsconfig.json is that one (a solution-style config such as create-vite's owns no
 * files itself), direct references only, as oxc-resolver does; without a tsconfig.json, each variant that includes
 * such a file.
 */
function owningProjects(appDir: string): OwningProjects | null {
  const dir = path.resolve(appDir);
  const compilesDir = (project: TsProject): boolean =>
    project.config.fileNames.some((file) => isNearestConfigDir(dir, path.resolve(file)));
  const readAll = (configPaths: string[]): TsProject[] =>
    configPaths
      .map(readProject)
      .filter((project): project is TsProject => project !== null)
      .filter(compilesDir);
  const [first, ...others] = projectConfigPaths(dir);
  if (first === undefined) return null;
  if (path.basename(first) !== 'tsconfig.json') {
    const peers = readAll([first, ...others]);
    return peers.length === 0 ? null : { root: null, peers };
  }
  const root = readProject(first);
  if (root === null) return null;
  const references = (root.config.projectReferences ?? []).map(ts.resolveProjectReferencePath);
  return { root, peers: readAll(references) };
}

/** Whether `dir` has a project of its own: a tsconfig.json, or a `tsconfig.*.json` variant that compiles its files. */
export function hasProjectConfig(dir: string): boolean {
  const [first] = projectConfigPaths(dir);
  if (first === undefined) return false;
  return path.basename(first) === 'tsconfig.json' || owningProjects(dir) !== null;
}

/**
 * A `paths` key whose `*` follows its prefix directly (`"@*": ["./src/*"]`, so `@components/x` is `src/components/x`):
 * one alias per folder and source file of the target, the way `baseUrl` folders become aliases, and the prefix itself,
 * since TypeScript also matches `@/components/x` (the `*` taking the slash).
 */
function gluedPatternAliases(prefix: string, targetDir: string): Record<string, string> {
  const map: Record<string, string> = prefix === '' ? {} : { [prefix]: targetDir };
  let entries;
  try {
    entries = readdirSync(targetDir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  } catch {
    return map;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      map[prefix + entry.name] = path.resolve(targetDir, entry.name);
    } else if (entry.isFile() && isSourceFileName(entry.name)) {
      const stem = entry.name.replace(/\.[^.]+$/, '');
      map[prefix + stem] = path.resolve(targetDir, stem);
    }
  }
  return map;
}

function configAliases({ configPath, config }: TsProject): Record<string, string> {
  const options = config.options;
  const paths = options.paths ?? {};

  const pathsBasePath = (options as { pathsBasePath?: string }).pathsBasePath;
  const base = options.baseUrl ?? pathsBasePath ?? path.dirname(configPath);

  const map: Record<string, string> = {};
  for (const [alias, targets] of Object.entries(paths)) {
    const firstTarget = targets?.[0];
    if (firstTarget === undefined) {
      continue;
    }
    if (alias.endsWith('*') && !alias.endsWith('/*') && firstTarget.endsWith('/*')) {
      const glued = gluedPatternAliases(
        alias.slice(0, -1),
        path.resolve(base, firstTarget.slice(0, -2)),
      );
      for (const [key, dir] of Object.entries(glued)) map[key] ??= dir;
      continue;
    }
    const cleanAlias = alias.replace(/\/\*$/, '');
    const cleanTarget = firstTarget.replace(/\/\*$/, '');
    map[cleanAlias] = path.resolve(base, cleanTarget);
  }

  if (options.baseUrl !== undefined) {
    try {
      const entries = readdirSync(options.baseUrl, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        if (map[entry.name] === undefined)
          map[entry.name] = path.resolve(options.baseUrl, entry.name);
      }
    } catch {
      /* v8 ignore next -- unreadable baseUrl dir contributes no first-party prefixes */
    }
  }

  return map;
}

/** The aliases the peers add: those the root does not map, unless two peers map them differently. */
function peerAliases(
  peers: readonly TsProject[],
  rootAliases: Record<string, string>,
): Record<string, string> {
  const added: Record<string, string> = {};
  const ambiguous = new Set<string>();
  for (const peer of peers) {
    for (const [alias, target] of Object.entries(configAliases(peer))) {
      if (Object.hasOwn(rootAliases, alias)) continue;
      if (Object.hasOwn(added, alias) && added[alias] !== target) ambiguous.add(alias);
      added[alias] ??= target;
    }
  }
  for (const alias of ambiguous) delete added[alias];
  return added;
}

export function buildWorkspaceMap(rootDir: string): Record<string, string> {
  const projects = owningProjects(rootDir);
  if (projects === null) {
    return {};
  }

  const rootAliases = projects.root === null ? {} : configAliases(projects.root);
  const map = { ...rootAliases, ...peerAliases(projects.peers, rootAliases) };

  for (const [alias, dir] of Object.entries(svelteKitAliases(rootDir))) map[alias] ??= dir;

  const self = ownPackageName(rootDir);
  if (self !== null && map[self] === undefined) map[self] = path.resolve(rootDir);

  return map;
}

/**
 * The tsconfig TypeScript compiles a file of `appDir` with: the first of its tsconfig.json and the peers that include
 * the file, else the first of them.
 */
export function owningConfigPath(appDir: string): (file: string) => string {
  const projects = owningProjects(appDir);
  const owners =
    projects === null
      ? []
      : [...(projects.root === null ? [] : [projects.root]), ...projects.peers];
  const fallback = owners[0]?.configPath ?? path.join(path.resolve(appDir), 'tsconfig.json');
  if (owners.length <= 1) return () => fallback;
  const files = owners.map(({ configPath, config }) => ({
    configPath,
    files: new Set(config.fileNames.map((file) => path.resolve(file))),
  }));
  return (file) => {
    const absolute = path.resolve(file);
    return files.find((owner) => owner.files.has(absolute))?.configPath ?? fallback;
  };
}
