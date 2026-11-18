import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { ModuleLoader } from '../scanner/file-walker.js';
import { matchesGlob } from '../scanner/globs.js';
import { VITE_CONFIG_NAMES } from '../scanner/vite-config.js';
import { type LayerAlias, resolveImportPath } from './layer-paths.js';

/** The nearest folder at or above `dir` (a path from `root`) holding one of `names`; null when none does. */
function nearestHolding(root: string, dir: string, names: readonly string[]): string | null {
  for (let current = dir; ; current = path.posix.dirname(current)) {
    const here = current === '.' ? '' : current;
    if (names.some((name) => existsSync(path.join(root, here, name)))) return here;
    if (here === '') return null;
  }
}

/** A per-folder cache of what each file's folder gives. */
function byFolder<T>(read: (dir: string) => T): (file: string) => T {
  const cache = new Map<string, T>();
  return (file) => {
    const dir = path.posix.dirname(file);
    let found = cache.get(dir);
    if (found === undefined) {
      found = read(dir);
      cache.set(dir, found);
    }
    return found;
  };
}

/**
 * Where an absolute `import.meta.glob('/src/...')` pattern starts: the nearest folder above the file with a Vite
 * config, else with a package.json, else the root. Vite resolves it from its project root.
 */
export const createViteRoots = (root: string): ((file: string) => string) =>
  byFolder(
    (dir) =>
      nearestHolding(root, dir, VITE_CONFIG_NAMES) ??
      nearestHolding(root, dir, ['package.json']) ??
      '',
  );

/** Whether Vite bundles a file: a folder at or above it holds a Vite config. */
export const createViteProjects = (root: string): ((file: string) => boolean) =>
  byFolder((dir) => nearestHolding(root, dir, VITE_CONFIG_NAMES) !== null);

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

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A `.js`-family extension also names the TypeScript source it is compiled from, as static imports do. */
const SOURCE_OF: Record<string, string> = {
  '.js': '(?:js|ts|tsx)',
  '.jsx': '(?:jsx|tsx)',
  '.mjs': '(?:mjs|ts|tsx)',
  '.cjs': '(?:cjs|ts|tsx)',
};

/**
 * The files a computed path can name: its written head resolves like an import (relative or through an alias), and
 * each hole matches within one folder in a Vite project (Vite expands a dynamic import one level, only one that ends
 * with a file extension, and not `./${x}.ext` in the importer's own folder) and across folders elsewhere (a webpack
 * context, recursive by default, or a runtime path). A path that is only a hole inside the importer's own folder or a
 * folder above it names nothing: it would count every file around the importer as loaded.
 */
function pathTargets(
  { parts }: Extract<ModuleLoader, { kind: 'path' }>,
  from: string,
  files: readonly string[],
  aliases: readonly LayerAlias[],
  bundledByVite: boolean,
): string[] {
  const [head, ...afterHoles] = parts as [string, ...string[]];
  const slash = head.lastIndexOf('/');
  if (slash === -1) return [];
  const folder = resolveImportPath(from, head.slice(0, slash) || '/', aliases);
  if (folder === null) return [];
  const pieces = [head.slice(slash + 1), ...afterHoles];
  const fromDir = path.posix.dirname(from);
  const aroundImporter = folder === '' || fromDir === folder || fromDir.startsWith(`${folder}/`);
  if (afterHoles.length > 0 && pieces.join('') === '' && aroundImporter) return [];
  const last = pieces.length - 1;
  if (bundledByVite && afterHoles.length > 0) {
    if (!/\.[^/.]+$/.test(pieces[last]!)) return [];
    const ownFolderAnyName = folder === fromDir && pieces[0] === '' && /^\.\w+$/.test(pieces[1]!);
    if (afterHoles.length === 1 && ownFolderAnyName) return [];
  }
  const extension = /\.[mc]?jsx?$/.exec(pieces[last]!)?.[0];
  const body = pieces
    .map((piece, index) =>
      index === last && extension !== undefined
        ? `${escapeRegExp(piece.slice(0, -extension.length))}\\.${SOURCE_OF[extension]}`
        : escapeRegExp(piece),
    )
    .join(bundledByVite ? '[^/]*' : '.*');
  const pattern = new RegExp(`^${escapeRegExp(folder === '' ? '' : `${folder}/`)}${body}$`);
  return files.filter((file) => pattern.test(file));
}

/** The files, by paths from the root, that a loader written in `from` brings into the build. */
export function loadedFiles(
  loader: ModuleLoader,
  from: string,
  files: readonly string[],
  aliases: readonly LayerAlias[],
  viteRoot: string,
  bundledByVite: boolean,
): string[] {
  if (loader.kind === 'glob') return globTargets(loader, from, files, aliases, viteRoot);
  if (loader.kind === 'context') return contextTargets(loader, from, files, aliases);
  return pathTargets(loader, from, files, aliases, bundledByVite);
}
