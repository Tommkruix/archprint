import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { findTsconfigDirs } from '../scanner/app-dirs.js';
import { valueModuleImports, walkRepo } from '../scanner/file-walker.js';
import { globalReferences, type GlobalReference } from '../scanner/global-references.js';
import { matchesAnyGlob, matchesGlob } from '../scanner/globs.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from '../scanner/workspace-packages.js';
import { packageEntry, resolveImportTarget, type WorkspacePackage } from './import-target.js';
import { layerAliases } from './layer-detector.js';
import type { LayerAlias } from './layer-paths.js';

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

/** A source file by its path from the root the rules are written against. */
export interface CodebaseFile {
  path: string;
  absolutePath: string;
  /** The tsconfig directory (from the root) whose aliases resolve its imports; null when none is above it. */
  app: string | null;
  test: boolean;
}

export interface DeclaredCodebase {
  files: readonly CodebaseFile[];
  /** The repo-relative module an import in `file` names, first hop; null for a package outside the repo. */
  targetOf(file: CodebaseFile, specifier: string): string | null;
}

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

const deepestOwner = (dirs: readonly string[], file: string): string | undefined =>
  dirs.filter((dir) => file.startsWith(dir + path.sep)).sort((a, b) => b.length - a.length)[0];

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* v8 ignore next -- defensive: the manifest changed after the workspace map read it */
    return undefined;
  }
}

function workspacePackages(root: string, isFile: (path: string) => boolean): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const [name, absoluteDir] of Object.entries(
    buildWorkspacePackageMap(findWorkspaceRoot(root)),
  )) {
    const dir = toPosix(path.relative(root, absoluteDir));
    if (dir === '' || dir.startsWith('..')) continue;
    const manifest = readJson(path.join(absoluteDir, 'package.json'));
    packages.push({ name, dir, entry: packageEntry(manifest, dir, isFile) });
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every source file under `root`, by its path from `root` (the base the rules' globs are written against). Each
 * file's imports resolve through the aliases of the deepest tsconfig above it, so a small package that is not an
 * app of its own still counts, as a scope and as a target.
 */
export function loadCodebase(root: string): DeclaredCodebase {
  const absoluteRoot = path.resolve(root);
  const configDirs = findTsconfigDirs(absoluteRoot);
  const aliases = new Map<string, LayerAlias[]>();
  const aliasesOf = (app: string): LayerAlias[] => {
    let found = aliases.get(app);
    if (found === undefined) {
      found = layerAliases(path.join(absoluteRoot, app)).map((alias) => ({
        prefix: alias.prefix,
        dir: path.posix.join(app, alias.dir),
      }));
      aliases.set(app, found);
    }
    return found;
  };
  const files = walkRepo(absoluteRoot).map((walked) => {
    const owner = deepestOwner(configDirs, walked.absolutePath);
    return {
      path: walked.relativePath,
      absolutePath: walked.absolutePath,
      app: owner === undefined ? null : toPosix(path.relative(absoluteRoot, owner)),
      test: walked.role === 'TEST',
    };
  });
  const known = new Set(files.map((file) => file.path));
  const isFile = (candidate: string): boolean => known.has(candidate);
  const packages = workspacePackages(absoluteRoot, isFile);
  return {
    files,
    targetOf: (file, specifier) =>
      resolveImportTarget(
        file.path,
        specifier,
        file.app === null ? [] : aliasesOf(file.app),
        packages,
        isFile,
      ),
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
    .map((imp) => ({ file: file.path, line: imp.line, subject: imp.specifier }));
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
    const scope = codebase.files.filter((file) => inScope(file, rule)).map((file) => file.path);
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
            file: file.path,
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
      measure.scope.push(file.path);
      measure.violations.push(...found);
    } else if (found.length > 0) {
      measure.elsewhere.push(file.path);
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
