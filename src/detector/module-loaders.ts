import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { ModuleLoader } from '../scanner/file-walker.js';
import { matchesGlob } from '../scanner/globs.js';
import { type LayerAlias, resolveImportPath } from './layer-paths.js';

const VITE_CONFIG_NAMES = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map(
  (ext) => `vite.config.${ext}`,
);

/**
 * Where an absolute `import.meta.glob('/src/...')` pattern starts: the nearest folder above the file with a Vite
 * config, else with a package.json, else the root. Vite resolves it from its project root.
 */
export function createViteRoots(root: string): (file: string) => string {
  const cache = new Map<string, string>();
  const holds = (dir: string, names: readonly string[]): boolean =>
    names.some((name) => existsSync(path.join(root, dir, name)));
  const nearest = (dir: string, names: readonly string[]): string | null => {
    for (let current = dir; ; current = path.posix.dirname(current)) {
      const here = current === '.' ? '' : current;
      if (holds(here, names)) return here;
      if (here === '') return null;
    }
  };
  return (file) => {
    const dir = path.posix.dirname(file);
    let found = cache.get(dir);
    if (found === undefined) {
      found = nearest(dir, VITE_CONFIG_NAMES) ?? nearest(dir, ['package.json']) ?? '';
      cache.set(dir, found);
    }
    return found;
  };
}

/** A glob or folder written in `from`, as a path from the root, or null when it leaves the root or names no alias. */
function fromRoot(
  from: string,
  written: string,
  aliases: readonly LayerAlias[],
  viteRoot: string,
): string | null {
  if (written.startsWith('/')) return path.posix.join(viteRoot, written.slice(1));
  return resolveImportPath(from, written, aliases);
}

/** The file a glob's relative patterns resolve from: the caller, or a file in its `base` folder when it has one. */
function patternOrigin(
  from: string,
  base: string | null,
  aliases: readonly LayerAlias[],
  viteRoot: string,
): string | null {
  if (base === null) return from;
  const folder = fromRoot(from, base, aliases, viteRoot);
  return folder === null ? null : path.posix.join(folder, '_');
}

function globTargets(
  loader: Extract<ModuleLoader, { kind: 'glob' }>,
  from: string,
  files: readonly string[],
  aliases: readonly LayerAlias[],
  viteRoot: string,
): string[] {
  const origin = patternOrigin(from, loader.base, aliases, viteRoot);
  if (origin === null) return [];
  const { patterns } = loader;
  const resolve = (pattern: string): string | null =>
    fromRoot(pattern.startsWith('.') ? origin : from, pattern, aliases, viteRoot);
  const included = patterns.filter((pattern) => !pattern.startsWith('!')).map(resolve);
  const excluded = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => resolve(pattern.slice(1)));
  const globs = included.filter((glob): glob is string => glob !== null);
  const ignores = excluded.filter((glob): glob is string => glob !== null);
  return files.filter(
    (file) =>
      globs.some((glob) => matchesGlob(file, glob)) &&
      !ignores.some((glob) => matchesGlob(file, glob)),
  );
}

function contextTargets(
  loader: Extract<ModuleLoader, { kind: 'context' }>,
  from: string,
  files: readonly string[],
  aliases: readonly LayerAlias[],
): string[] {
  const directory = resolveImportPath(from, loader.directory, aliases);
  if (directory === null) return [];
  const prefix = directory === '' ? '' : `${directory}/`;
  return files.filter((file) => {
    if (!file.startsWith(prefix)) return false;
    const inside = file.slice(prefix.length);
    if (!loader.recursive && inside.includes('/')) return false;
    return loader.filter === null || loader.filter.test(`./${inside}`);
  });
}

/** The files, by paths from the root, that a loader written in `from` brings into the build. */
export function loadedFiles(
  loader: ModuleLoader,
  from: string,
  files: readonly string[],
  aliases: readonly LayerAlias[],
  viteRoot: string,
): string[] {
  return loader.kind === 'glob'
    ? globTargets(loader, from, files, aliases, viteRoot)
    : contextTargets(loader, from, files, aliases);
}
