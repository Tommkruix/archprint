import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { findTsconfigDirs } from '../scanner/app-dirs.js';
import { valueModuleImports, walkRepo } from '../scanner/file-walker.js';
import { globalReferences, type GlobalReference } from '../scanner/global-references.js';
import { matchesAnyGlob, matchesGlob } from '../scanner/globs.js';
import { buildWorkspacePackageMap, findWorkspaceRoots } from '../scanner/workspace-packages.js';
import { packageEntry, packageSubpaths, sourceFileFor } from './import-target.js';
import { layerAliases } from './layer-detector.js';
import { type LayerAlias, resolveImportTarget, type WorkspacePackage } from './layer-paths.js';

/** A package specifier glob, optionally limited to some of its exported names (`default` for a default import). */
export interface PackageTarget {
  name: string;
  imports?: string[];
}

interface RuleScope {
  files: string[];
  except: string[];
}

/** A rule a team stated, as a template: which files it covers and what they must not do. */
export type DeclaredDefinition = RuleScope &
  (
    | { template: 'forbid-import'; targets: string[]; packages: PackageTarget[] }
    | { template: 'forbid-usage'; usage: string[] }
    | { template: 'forbid-file' }
  );

/** A source file, by its path from the root the rules' globs are written against and from the directory measured. */
export interface CodebaseFile {
  path: string;
  /** Its path in the directory measured: the app for an adopted rule, the root for the gap report. */
  local: string;
  absolutePath: string;
  test: boolean;
}

export interface DeclaredCodebase {
  files: readonly CodebaseFile[];
  /** The repo-relative module an import in `file` names, first hop; null for a package outside the repo. */
  targetOf(file: CodebaseFile, specifier: string): string | null;
}

/** A break of a rule, by the file's path in the directory measured. */
export interface DeclaredViolation {
  file: string;
  line: number;
  subject: string;
}

export interface DeclaredMeasure {
  /** The files the rule covers: source files in scope, tests included only for forbid-file. */
  scope: string[];
  violations: DeclaredViolation[];
  /** Files outside the scope that do what the rule forbids: evidence the rule is not vacuous. */
  elsewhere: string[];
  /** The `targets` globs no source file matches. */
  unmatchedTargets: string[];
}

const toPosix = (value: string): string => value.split(path.sep).join('/');

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* v8 ignore next -- defensive: the manifest changed after the workspace map read it */
    return undefined;
  }
}

/** The packages of every workspace under `root` and the one above it; on a name clash, the shallowest workspace's. */
function workspacePackages(root: string, isFile: (path: string) => boolean): WorkspacePackage[] {
  const packages = new Map<string, WorkspacePackage>();
  for (const workspaceRoot of findWorkspaceRoots(root)) {
    for (const [name, absoluteDir] of Object.entries(buildWorkspacePackageMap(workspaceRoot))) {
      const dir = toPosix(path.relative(root, absoluteDir));
      if (dir === '' || dir.startsWith('..') || packages.has(name)) continue;
      const manifest = readJson(path.join(absoluteDir, 'package.json'));
      packages.set(name, {
        name,
        dir,
        entry: packageEntry(manifest, dir, isFile),
        subpaths: packageSubpaths(manifest, dir),
      });
    }
  }
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A tsconfig directory, from the root, with its path aliases rebased to the root. */
export interface ConfigAliases {
  dir: string;
  aliases: LayerAlias[];
}

/** What resolves an import: each tsconfig directory with its aliases, deepest first, and the workspace packages. */
export interface ImportResolution {
  configs: ConfigAliases[];
  packages: WorkspacePackage[];
}

const fileUnder =
  (root: string) =>
  (candidate: string): boolean =>
    existsSync(path.join(root, candidate));

/** How imports under `dir` (the whole root by default) resolve, in paths from `root`; a candidate is a file on disk. */
export function importResolution(root: string, dir: string = root): ImportResolution {
  const absoluteRoot = path.resolve(root);
  const configs = findTsconfigDirs(path.resolve(dir))
    .map((configDir) => {
      const owner = toPosix(path.relative(absoluteRoot, configDir));
      return {
        dir: owner,
        aliases: layerAliases(configDir).map((alias) => ({
          prefix: alias.prefix,
          dir: path.posix.join(owner, alias.dir),
        })),
      };
    })
    .sort((a, b) => b.dir.length - a.dir.length || a.dir.localeCompare(b.dir));
  return { configs, packages: workspacePackages(absoluteRoot, fileUnder(absoluteRoot)) };
}

/** The aliases of the deepest tsconfig directory above a root-relative file; `configs` come deepest first. */
export function aliasesFor(file: string, configs: readonly ConfigAliases[]): LayerAlias[] {
  const owner = configs.find(({ dir }) => dir === '' || file.startsWith(dir + '/'));
  return owner === undefined ? [] : owner.aliases;
}

/**
 * The source files under `dir` (the whole root by default), each by its path from `root`, the base the rules' globs
 * are written against. A file's imports resolve through the aliases of the deepest tsconfig above it, so a small
 * package that is not an app of its own still counts.
 */
export function loadCodebase(root: string, dir: string = root): DeclaredCodebase {
  const absoluteRoot = path.resolve(root);
  const absoluteDir = path.resolve(dir);
  const prefix = toPosix(path.relative(absoluteRoot, absoluteDir));
  const { configs, packages } = importResolution(absoluteRoot, absoluteDir);
  const fileFor = sourceFileFor(fileUnder(absoluteRoot));
  const files = walkRepo(absoluteDir).map((walked) => ({
    path: path.posix.join(prefix, walked.relativePath),
    local: walked.relativePath,
    absolutePath: walked.absolutePath,
    test: walked.role === 'TEST',
  }));
  return {
    files,
    targetOf: (file, specifier) =>
      resolveImportTarget(file.path, specifier, aliasesFor(file.path, configs), packages, fileFor),
  };
}

const inScope = (file: CodebaseFile, rule: DeclaredDefinition): boolean =>
  matchesAnyGlob(file.path, rule.files) && !matchesAnyGlob(file.path, rule.except);

const takesForbiddenName = (names: string[] | null, target: PackageTarget): boolean =>
  target.imports === undefined ||
  (names !== null && names.some((name) => name === '*' || target.imports!.includes(name)));

function importViolations(
  codebase: DeclaredCodebase,
  file: CodebaseFile,
  rule: Extract<DeclaredDefinition, { template: 'forbid-import' }>,
): DeclaredViolation[] {
  let imports;
  try {
    imports = valueModuleImports(file.absolutePath);
  } catch {
    /* v8 ignore next -- defensive: an unreadable file has no imports */
    return [];
  }
  return imports
    .filter((imp) => {
      if (
        rule.packages.some(
          (target) =>
            matchesGlob(imp.specifier, target.name) && takesForbiddenName(imp.names, target),
        )
      ) {
        return true;
      }
      const resolved = rule.targets.length === 0 ? null : codebase.targetOf(file, imp.specifier);
      return resolved !== null && rule.targets.some((glob) => matchesGlob(resolved, glob));
    })
    .map((imp) => ({ file: file.local, line: imp.line, subject: imp.specifier }));
}

function usageReferences(
  files: readonly CodebaseFile[],
  rules: readonly DeclaredDefinition[],
): Map<string, GlobalReference[]> {
  const usages = [
    ...new Set(rules.flatMap((rule) => (rule.template === 'forbid-usage' ? rule.usage : []))),
  ];
  const references = new Map<string, GlobalReference[]>();
  if (usages.length === 0) return references;
  for (const file of files) {
    if (file.test) continue;
    try {
      references.set(file.path, globalReferences(file.absolutePath, usages));
    } catch {
      /* v8 ignore next -- defensive: an unreadable file reads no globals */
      references.set(file.path, []);
    }
  }
  return references;
}

function measureOne(
  codebase: DeclaredCodebase,
  rule: DeclaredDefinition,
  references: Map<string, GlobalReference[]>,
): DeclaredMeasure {
  if (rule.template === 'forbid-file') {
    const scope = codebase.files.filter((file) => inScope(file, rule)).map((file) => file.local);
    return {
      scope,
      violations: scope.map((file) => ({ file, line: 1, subject: file })),
      elsewhere: [],
      unmatchedTargets: [],
    };
  }
  const violationsIn = (file: CodebaseFile): DeclaredViolation[] =>
    rule.template === 'forbid-import'
      ? importViolations(codebase, file, rule)
      : (references.get(file.path) ?? [])
          .filter((reference) => rule.usage.includes(reference.usage))
          .map((reference) => ({
            file: file.local,
            line: reference.line,
            subject: reference.usage,
          }));
  const measure: DeclaredMeasure = {
    scope: [],
    violations: [],
    elsewhere: [],
    unmatchedTargets: [],
  };
  for (const file of codebase.files) {
    if (file.test) continue;
    const found = violationsIn(file);
    if (inScope(file, rule)) {
      measure.scope.push(file.local);
      measure.violations.push(...found);
    } else if (found.length > 0) {
      measure.elsewhere.push(file.local);
    }
  }
  if (rule.template === 'forbid-import') {
    measure.unmatchedTargets = rule.targets.filter(
      (glob) => !codebase.files.some((file) => matchesGlob(file.path, glob)),
    );
  }
  return measure;
}

/** What each rule covers and what breaks it today, in the order given; globals are read once for every rule. */
export function measureDeclared(
  codebase: DeclaredCodebase,
  rules: readonly DeclaredDefinition[],
): DeclaredMeasure[] {
  const references = usageReferences(codebase.files, rules);
  return rules.map((rule) => measureOne(codebase, rule, references));
}
