import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import { declaredPackages, packageName } from '../scanner/package-name.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from '../scanner/workspace-packages.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const BUILTINS = new Set(builtinModules);

/** The names of the workspace's packages, which count as declared. */
export const workspacePackageNames = (appDir: string): string[] =>
  Object.keys(buildWorkspacePackageMap(findWorkspaceRoot(path.resolve(appDir)))).sort();

/** The package.json files whose dependencies count as declared: the app's, and the workspace root's. */
export function declaringPackageJsons(appDir: string): string[] {
  const root = path.resolve(appDir);
  const workspaceRoot = findWorkspaceRoot(root);
  return [root, ...(workspaceRoot === root ? [] : [workspaceRoot])].map((dir) =>
    path.join(dir, 'package.json'),
  );
}

const readIfPresent = (file: string): string =>
  existsSync(file) ? readFileSync(file, 'utf-8') : '';

export interface PhantomDependencyViolation {
  file: string;
  specifier: string;
  package: string;
}

export interface PhantomDependencyAnalysis {
  appDir: string;
  externalImporterCount: number;
  /** The package.json files and workspace packages that count as declared. */
  declaringPackageJsons: string[];
  workspacePackages: string[];
  offenderCount: number;
  gate: GateResult;
  violations: PhantomDependencyViolation[];
}

export interface PhantomDependencyOptions {
  resolve?: boolean;
}

export function detectPhantomDependencies(
  appDir: string,
  options: PhantomDependencyOptions = {},
): PhantomDependencyAnalysis {
  const root = path.resolve(appDir);
  const resolve = options.resolve ?? false;
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const aliasPrefixes = Object.keys(buildWorkspaceMap(root)).map((key) =>
    key.replace(/\/?\*$/, ''),
  );

  const packageJsons = declaringPackageJsons(root);
  const workspacePackages = workspacePackageNames(root);
  const declared = new Set([
    ...packageJsons.flatMap((file) => declaredPackages(readIfPresent(file))),
    ...workspacePackages,
  ]);

  const analyze = createImportAnalyzer(root, { resolve });
  const externalImporters = new Set<string>();
  const offenders = new Set<string>();
  const violations: PhantomDependencyViolation[] = [];
  for (const file of files) {
    let imports: ResolvedImport[];
    try {
      imports = analyze(file.absolutePath);
    } catch {
      /* v8 ignore next -- defensive: analyze throws only on an unreadable/malformed source file */
      imports = [];
    }
    for (const imp of imports) {
      if (!imp.hasValueBinding) continue;
      const name = packageName(imp.specifier, aliasPrefixes, BUILTINS);
      if (name === null) continue;
      externalImporters.add(file.relativePath);
      if (!declared.has(name)) {
        offenders.add(file.relativePath);
        violations.push({ file: file.relativePath, specifier: imp.specifier, package: name });
      }
    }
  }

  return {
    appDir: root,
    externalImporterCount: externalImporters.size,
    declaringPackageJsons: packageJsons,
    workspacePackages,
    offenderCount: offenders.size,
    gate: evaluateGate({
      roleFileCount: externalImporters.size,
      violatingFileCount: offenders.size,
      roleConfidence: 1,
    }),
    violations: violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier),
    ),
  };
}
