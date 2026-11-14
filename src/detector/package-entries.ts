import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { directoriesUnder } from '../scanner/directory-walk.js';

const TSCONFIGS = ['tsconfig.json', 'tsconfig.build.json'];
/** Folders bundlers (tsup, unbuild, esbuild scripts) write to when no tsconfig `outDir` says so. */
const OUTPUT_DIRS = new Set(['dist', 'lib', 'build', 'out']);
const EXTENSION = /(\.d)?\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;

const toPosix = (value: string): string => value.split(path.sep).join('/');
const stem = (file: string): string => file.replace(EXTENSION, '');

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(stringLeaves);
}

const localPaths = (targets: readonly string[]): string[] =>
  targets
    .map((target) => target.replace(/^\.\//, ''))
    .filter(
      (target) => target !== '' && !target.startsWith('../') && !/^[a-z]+:|^\//i.test(target),
    );

/** The relative paths a package.json exposes: `main`, `module`, `types`, `browser`, `bin` and every `exports` target. */
export function manifestTargets(manifest: Record<string, unknown>): string[] {
  const fields = ['main', 'module', 'types', 'typings', 'browser', 'bin', 'exports'];
  return localPaths(fields.flatMap((field) => stringLeaves(manifest[field])));
}

const RUNNERS = new Set([
  'node',
  'tsx',
  'ts-node',
  'ts-node-esm',
  'bun',
  'deno',
  'esno',
  'esr',
  'babel-node',
  'nodemon',
  'vite-node',
  'jiti',
]);
/** Runner flags whose value is a module the runner loads (`--import ./register.ts`) or a config file. */
const VALUE_FLAGS = new Set([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '-c',
  '--config',
]);
const SOURCE_FILE = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;

/** The files one shell command runs: a runner's first positional argument and the modules or config its flags name. */
function commandTargets(command: string): string[] {
  const words = command
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^['"]|['"]$/g, ''));
  const runner = words.findIndex((word) => RUNNERS.has(word));
  if (runner === -1) return [];
  const targets: string[] = [];
  for (let index = runner + 1; index < words.length; index++) {
    const word = words[index]!;
    if (index === runner + 1 && word === 'run') continue;
    const [flag, inline] = word.split('=', 2) as [string, string | undefined];
    if (VALUE_FLAGS.has(flag)) {
      const value = inline ?? words[++index];
      if (value !== undefined && SOURCE_FILE.test(value)) targets.push(value);
      continue;
    }
    if (word.startsWith('-')) continue;
    if (SOURCE_FILE.test(word)) targets.push(word);
    break;
  }
  return targets;
}

/**
 * The files package.json `scripts` run through a JavaScript runtime (`node`, `tsx`, `bun`, ...), as knip reads them:
 * the first positional argument and the modules or config a runner flag names. Other tools' arguments, such as a lint
 * glob, are not entries.
 */
export function scriptTargets(manifest: Record<string, unknown>): string[] {
  const scripts = manifest.scripts;
  if (scripts === null || typeof scripts !== 'object') return [];
  return localPaths(
    Object.values(scripts)
      .filter((command): command is string => typeof command === 'string')
      .flatMap((command) => command.split(/&&|\|\||[;|]/))
      .flatMap(commandTargets),
  );
}

interface CompiledRoot {
  outDir: string;
  rootDir: string;
}

function commonDirectory(files: readonly string[]): string {
  const parts = files.map((file) => path.dirname(file).split('/'));
  const shared: string[] = [];
  for (let index = 0; parts.every((segments) => index < segments.length); index++) {
    const segment = parts[0]![index]!;
    if (!parts.every((segments) => segments[index] === segment)) break;
    shared.push(segment);
  }
  return shared.join('/').replace(/^\.$/, '');
}

/** Where each of the package's tsconfigs writes its output and the source folder that output mirrors. */
function compiledRoots(packageDir: string): CompiledRoot[] {
  const roots: CompiledRoot[] = [];
  for (const name of TSCONFIGS) {
    const configPath = path.join(packageDir, name);
    if (!existsSync(configPath)) continue;
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error !== undefined) continue;
    const { options, fileNames } = ts.parseJsonConfigFileContent(read.config, ts.sys, packageDir);
    if (options.outDir === undefined) continue;
    const relative = (dir: string): string => toPosix(path.relative(packageDir, dir));
    const inputs = fileNames.filter((file) => !/\.d\.[cm]?ts$/.test(file)).map(relative);
    if (options.rootDir === undefined && inputs.length === 0) continue;
    const rootDir =
      options.rootDir === undefined ? commonDirectory(inputs) : relative(options.rootDir);
    const outDir = relative(options.outDir);
    if (outDir === '' || outDir.startsWith('..') || rootDir.startsWith('..')) continue;
    roots.push({ outDir, rootDir });
  }
  return roots;
}

/** The source paths a target may have been built from: itself, through each tsconfig `outDir`, and through `src/`. */
function sourceCandidates(target: string, roots: readonly CompiledRoot[]): string[] {
  const candidates = [target];
  for (const { outDir, rootDir } of roots) {
    if (target.startsWith(`${outDir}/`)) {
      candidates.push(path.posix.join(rootDir, target.slice(outDir.length + 1)));
    }
  }
  const [first, ...rest] = target.split('/');
  if (OUTPUT_DIRS.has(first!) && rest.length > 0) candidates.push(['src', ...rest].join('/'));
  return candidates;
}

function matcherFor(candidate: string): (fileStem: string) => boolean {
  if (candidate.endsWith('/')) return (fileStem) => fileStem.startsWith(candidate);
  const target = stem(candidate);
  if (!target.includes('*')) {
    return (fileStem) => fileStem === target || fileStem === `${target}/index`;
  }
  const pattern = new RegExp(
    `^${target
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+')}$`,
  );
  return (fileStem) => pattern.test(fileStem);
}

/** The files, given relative to the package directory, that the package's manifest exposes. */
function exposedBy(packageDir: string, files: readonly string[]): string[] {
  const manifest = readJson(path.join(packageDir, 'package.json'));
  if (manifest === null) return [];
  const roots = compiledRoots(packageDir);
  const matchers = [...manifestTargets(manifest), ...scriptTargets(manifest)]
    .flatMap((target) => sourceCandidates(target, roots))
    .map(matcherFor);
  return files.filter((file) => matchers.some((matches) => matches(stem(file))));
}

function nearestPackageAbove(root: string): string | null {
  for (let dir = path.dirname(root); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

/** Each file inside the package, keyed by its path from the package directory, which lies above or below `root`. */
function pathsInPackage(
  packageDir: string,
  root: string,
  files: readonly string[],
): Map<string, string> {
  const down = toPosix(path.relative(root, packageDir));
  if (down.startsWith('..')) {
    const up = toPosix(path.relative(packageDir, root));
    return new Map(files.map((file) => [path.posix.join(up, file), file]));
  }
  const inside = down === '' ? files : files.filter((file) => file.startsWith(`${down}/`));
  return new Map(inside.map((file) => [down === '' ? file : file.slice(down.length + 1), file]));
}

/**
 * The files under `root` (paths from it) that a package exposes or runs through its package.json, so whoever installs
 * or runs the package loads them: those of every package at or below `root`, and of the nearest one above it. A target built
 * into a tsconfig `outDir`, or into `dist/`, `lib/`, `build/` or `out/`, counts for the source file it was built from.
 */
export function packageEntriesUnder(root: string, files: readonly string[]): Set<string> {
  const absoluteRoot = path.resolve(root);
  const packages = directoriesUnder(absoluteRoot, (dir) =>
    existsSync(path.join(dir, 'package.json')),
  );
  const above = packages.includes(absoluteRoot) ? null : nearestPackageAbove(absoluteRoot);
  const entries = new Set<string>();
  for (const packageDir of above === null ? packages : [above, ...packages]) {
    const byPackagePath = pathsInPackage(packageDir, absoluteRoot, files);
    for (const exposed of exposedBy(packageDir, [...byPackagePath.keys()])) {
      entries.add(byPackagePath.get(exposed)!);
    }
  }
  return entries;
}
