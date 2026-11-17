import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { matchingAliases } from '../detector/layer-paths.js';
import type { AliasEntry } from './resolve-import.js';
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
 * one alias per folder of `folder` (the target before its `*`, which `rest` follows) and, for a final `*`, per source
 * file, the way `baseUrl` folders become aliases, and then the prefix itself, since TypeScript also matches
 * `@/components/x` (the `*` taking the slash).
 */
function gluedPatternAliases(prefix: string, folder: string, rest: string): AliasEntry[] {
  const aliases: AliasEntry[] = prefix === '' || rest !== '' ? [] : [{ prefix, dir: folder }];
  let entries;
  try {
    entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  } catch {
    return aliases;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      aliases.push({ prefix: prefix + entry.name, dir: path.resolve(folder, entry.name + rest) });
    } else if (rest === '' && entry.isFile() && isSourceFileName(entry.name)) {
      const stem = entry.name.replace(/\.[^.]+$/, '');
      aliases.push({ prefix: prefix + stem, dir: path.resolve(folder, stem) });
    }
  }
  return aliases;
}

/** Whether a `paths` target's `*` is a whole path segment (a final `*`, or one followed by a slash). */
const isSegmentStar = (target: string, star: number): boolean =>
  star > 0 && target[star - 1] === '/' && (star === target.length - 1 || target[star + 1] === '/');

/**
 * A config's aliases, each `paths` target in order (a key with several targets repeats its prefix, for TypeScript
 * tries them in turn), a target keeping a `*` that is not its last segment; a `*` key's targets come before those of
 * an exact key of the same prefix (`"@ui/*"` and `"@ui"`), since TypeScript uses the exact key only for the bare
 * name; then its `baseUrl` folders.
 */
function configAliases({ configPath, config }: TsProject): AliasEntry[] {
  const options = config.options;
  const paths = options.paths ?? {};

  const pathsBasePath = (options as { pathsBasePath?: string }).pathsBasePath;
  const base = options.baseUrl ?? pathsBasePath ?? path.dirname(configPath);

  const patterns: AliasEntry[] = [];
  const exact: AliasEntry[] = [];
  const glued: AliasEntry[] = [];
  for (const [alias, targets] of Object.entries(paths)) {
    for (const target of targets ?? []) {
      const star = target.indexOf('*');
      if (alias.endsWith('*') && !alias.endsWith('/*') && isSegmentStar(target, star)) {
        glued.push(
          ...gluedPatternAliases(
            alias.slice(0, -1),
            path.resolve(base, target.slice(0, star)),
            target.slice(star + 1),
          ),
        );
        continue;
      }
      (alias.includes('*') ? patterns : exact).push({
        prefix: alias.replace(/\/\*$/, ''),
        dir: path.resolve(base, target.replace(/\/\*$/, '')),
      });
    }
  }
  const explicit = [...patterns, ...exact];
  const aliases = [...explicit, ...glued.filter(({ prefix }) => !hasPrefix(explicit, prefix))];

  if (options.baseUrl !== undefined) {
    try {
      const entries = readdirSync(options.baseUrl, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        if (!hasPrefix(aliases, entry.name)) {
          aliases.push({ prefix: entry.name, dir: path.resolve(options.baseUrl, entry.name) });
        }
      }
    } catch {
      /* v8 ignore next -- unreadable baseUrl dir contributes no first-party prefixes */
    }
  }

  return aliases;
}

const hasPrefix = (aliases: readonly AliasEntry[], prefix: string): boolean =>
  aliases.some((alias) => alias.prefix === prefix);

/** Each prefix's targets, in order. */
function targetsByPrefix(aliases: readonly AliasEntry[]): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  for (const { prefix, dir } of aliases) targets.set(prefix, [...(targets.get(prefix) ?? []), dir]);
  return targets;
}

/** The aliases the peers add: those the root does not map, unless two peers map them differently. */
function peerAliases(
  peers: readonly TsProject[],
  rootAliases: readonly AliasEntry[],
): AliasEntry[] {
  const added = new Map<string, string[]>();
  const ambiguous = new Set<string>();
  for (const peer of peers) {
    for (const [prefix, targets] of targetsByPrefix(configAliases(peer))) {
      if (hasPrefix(rootAliases, prefix)) continue;
      const known = added.get(prefix);
      if (known === undefined) added.set(prefix, targets);
      else if (known.join('\0') !== targets.join('\0')) ambiguous.add(prefix);
    }
  }
  return [...added]
    .filter(([prefix]) => !ambiguous.has(prefix))
    .flatMap(([prefix, targets]) => targets.map((dir) => ({ prefix, dir })));
}

/**
 * The import aliases of a folder, as absolute targets in the order TypeScript tries them: its tsconfig `paths` (a
 * prefix repeats for each fallback target) and `baseUrl` folders, the peers' additions, SvelteKit aliases, and the
 * package's own name unless a key already matches it, since TypeScript reads `paths` first.
 */
export function workspaceAliases(rootDir: string): AliasEntry[] {
  const projects = owningProjects(rootDir);
  if (projects === null) {
    return [];
  }

  const rootAliases = projects.root === null ? [] : configAliases(projects.root);
  const aliases = [...rootAliases, ...peerAliases(projects.peers, rootAliases)];

  for (const [prefix, dir] of Object.entries(svelteKitAliases(rootDir))) {
    if (!hasPrefix(aliases, prefix)) aliases.push({ prefix, dir });
  }

  const self = ownPackageName(rootDir);
  if (self !== null && matchingAliases(self, aliases).length === 0) {
    aliases.push({ prefix: self, dir: path.resolve(rootDir) });
  }

  return aliases.map(({ prefix, dir }) => ({
    prefix: prefix.replace(/\/?\*$/, ''),
    dir: dir.replace(/\/?\*$/, ''),
  }));
}

/** Each alias prefix of a folder with its first target (see `workspaceAliases`). */
export function buildWorkspaceMap(rootDir: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { prefix, dir } of workspaceAliases(rootDir)) map[prefix] ??= dir;
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
