import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Minimatch } from 'minimatch';
import { directoriesUnder } from '../scanner/directory-walk.js';
import { buildWorkspacePackageMap } from '../scanner/workspace-packages.js';
import { type CompiledRoot, compiledRoots, readJson } from './package-entries.js';

const toPosix = (value: string): string => value.split(path.sep).join('/');

/** ignore-walk's options for the rules npm-packlist hands it. */
const RULE_OPTIONS = { matchBase: true, dot: true, flipNegate: true, nocase: true } as const;

/** A rule of one path segment, which ignore-walk also matches against a nested folder's own name. */
const isRelativeRule = (rule: Minimatch): boolean =>
  rule.globParts.some((part) => part.length <= (part.at(-1) === '' ? 2 : 1));

/**
 * Whether a path from the package directory survives a gitignore-style rule list the way ignore-walk walks it: each
 * folder above the path must pass (an including rule may match it partially, since something inside may be
 * included, and a one-segment rule matches a nested folder by its name), then the path itself, the last matching rule
 * deciding each time.
 */
function packedByRules(lines: readonly string[]): (file: string) => boolean {
  const rules = lines.map((line) => line.trim()).map((line) => new Minimatch(line, RULE_OPTIONS));
  const matchesFolder = (rule: Minimatch, folder: string): boolean =>
    rule.match(`/${folder}/`) ||
    rule.match(`${folder}/`) ||
    (rule.negate && (rule.match(`/${folder}`, true) || rule.match(folder, true)));
  const passes = (entry: string, folder: boolean): boolean => {
    const name = entry.includes('/') ? path.posix.basename(entry) : null;
    let included = true;
    for (const rule of rules) {
      const matches =
        rule.match(`/${entry}`) ||
        rule.match(entry) ||
        (folder &&
          (matchesFolder(rule, entry) ||
            (name !== null && isRelativeRule(rule) && matchesFolder(rule, name))));
      if (matches) included = rule.negate;
    }
    return included;
  };
  return (file) => {
    const parts = file.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      if (!passes(parts.slice(0, depth).join('/'), true)) return false;
    }
    return passes(file, false);
  };
}

const GLOB = /[*?[{]/;

/**
 * The rules npm-packlist builds from a package.json `files` list: exclude everything, then include each entry (`./x`
 * read as `/x`, `x/*` as `x/**`), with its contents when it names a folder; a `!` entry excludes.
 */
function filesRules(files: readonly string[]): string[] {
  const rules = ['*'];
  for (const entry of files) {
    let file = entry.startsWith('./') ? entry.slice(1) : entry;
    if (file.endsWith('/*')) file += '*';
    rules.push(`!${file}`);
    if (!GLOB.test(file)) rules.push(`!${file}/**`);
  }
  return rules;
}

/** Whether a path from the package directory is in the tarball by the package.json `files` list, as npm packs it. */
export const shippedByFiles = (files: readonly string[]): ((file: string) => boolean) =>
  packedByRules(filesRules(files));

/**
 * A package a user can import any shipped file of: named, not private, without `exports` (which would limit imports
 * to its subpaths), and set up to publish (`files`, `publishConfig` or an `.npmignore`).
 */
function isDeepImportable(manifest: Record<string, unknown>, packageDir: string): boolean {
  return (
    typeof manifest.name === 'string' &&
    !manifest.private &&
    manifest.exports === undefined &&
    (Array.isArray(manifest.files) ||
      manifest.publishConfig !== undefined ||
      existsSync(path.join(packageDir, '.npmignore')))
  );
}

const BUILT_EXTENSION: Record<string, string[]> = {
  '.ts': ['.js', '.d.ts'],
  '.tsx': ['.js', '.d.ts'],
  '.mts': ['.mjs', '.d.mts'],
  '.cts': ['.cjs', '.d.cts'],
};

/**
 * The paths, from the package directory, a file (from the same directory) may have in the tarball: itself, when it lies
 * inside the package, and what each tsconfig that lists it as an input builds from it.
 */
function packedPaths(file: string, roots: readonly CompiledRoot[]): string[] {
  const packed = file.startsWith('../') ? [] : [file];
  const extension = path.posix.extname(file);
  for (const { outDir, rootDir, emits } of roots) {
    const fromRoot = path.posix.relative(rootDir, file);
    if (fromRoot.startsWith('../') || !emits(file)) continue;
    const built = path.posix.join(outDir, fromRoot);
    const base = built.slice(0, built.length - extension.length);
    for (const output of BUILT_EXTENSION[extension] ?? [extension]) packed.push(base + output);
  }
  return packed;
}

const packsElsewhere = (manifest: Record<string, unknown>): boolean => {
  const config = manifest.publishConfig;
  return config !== null && typeof config === 'object' && 'directory' in config;
};

const readLines = (file: string): string[] | null => {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    return null;
  }
};

/**
 * Which paths from the package directory the tarball holds: by its `files` list, else by its `.npmignore`, else by its
 * `.gitignore`, as npm reads them; every path when it packs another folder (`publishConfig.directory`) or has none.
 */
function packedBy(
  manifest: Record<string, unknown>,
  packageDir: string,
): (file: string) => boolean {
  if (packsElsewhere(manifest)) return () => true;
  if (Array.isArray(manifest.files)) {
    return shippedByFiles(manifest.files.filter((entry) => typeof entry === 'string'));
  }
  const ignored =
    readLines(path.join(packageDir, '.npmignore')) ??
    readLines(path.join(packageDir, '.gitignore'));
  return ignored === null ? () => true : packedByRules(ignored);
}

/**
 * The files under `root` (paths from it) that a published package without `exports` ships, as themselves or built
 * through one of its tsconfigs, so a user of the package can import them by path. A package that packs another folder
 * (`publishConfig.directory`) or has no `files` list ships every file it holds or builds; a workspace root never packs
 * its workspace packages, as npm leaves them out.
 */
export function shippedFilesUnder(root: string, files: readonly string[]): Set<string> {
  const absoluteRoot = path.resolve(root);
  const shipped = new Set<string>();
  for (const packageDir of directoriesUnder(absoluteRoot, (dir) =>
    existsSync(path.join(dir, 'package.json')),
  )) {
    const manifest = readJson(path.join(packageDir, 'package.json'));
    if (manifest === null || !isDeepImportable(manifest, packageDir)) continue;
    const dir = toPosix(path.relative(absoluteRoot, packageDir));
    const roots = compiledRoots(packageDir);
    const packs = packedBy(manifest, packageDir);
    const under = (folder: string) => (file: string) =>
      folder === '' || file.startsWith(`${folder}/`);
    const folders = [dir, ...roots.map(({ rootDir }) => path.posix.join(dir, rootDir))];
    const workspaces = Object.values(buildWorkspacePackageMap(packageDir)).map((member) =>
      toPosix(path.relative(absoluteRoot, member)),
    );
    const packed = (file: string): boolean =>
      folders.some((folder) => under(folder)(file)) &&
      !workspaces.some((member) => under(member)(file));
    for (const file of files.filter(packed)) {
      if (packedPaths(path.posix.relative(dir, file), roots).some(packs)) shipped.add(file);
    }
  }
  return shipped;
}
