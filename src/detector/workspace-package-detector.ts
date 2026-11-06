import * as path from 'node:path';
import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from '../scanner/workspace-packages.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';
import { packageSubpaths, readManifest } from './import-target.js';
import { matchingSubpath, type PackageSubpath } from './layer-paths.js';

export interface WorkspacePackageViolation {
  file: string;
  specifier: string;
  package: string;
}

export interface WorkspacePackageAnalysis {
  appDir: string;
  packages: string[];
  /** Each package's subpath exports, in the order Node.js matches them; empty when it defines none. */
  subpaths: Record<string, PackageSubpath[]>;
  consumerCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: WorkspacePackageViolation[];
}

export interface WorkspacePackageOptions {
  resolve?: boolean;
}

function matchPackage(specifier: string, names: readonly string[]): string | null {
  for (const name of names) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return name;
  }
  return null;
}

/**
 * The files that import a workspace package, and those that reach past what it exports: a package without `exports`
 * exposes only its name. A package that exports every subpath (`./*`, nothing blocked) has no deep path, so importing
 * it is evidence neither way and is left out.
 */
export function detectWorkspacePackageApi(
  appDir: string,
  options: WorkspacePackageOptions = {},
): WorkspacePackageAnalysis {
  const root = path.resolve(appDir);
  const packageDirs = buildWorkspacePackageMap(findWorkspaceRoot(root));
  const names = Object.keys(packageDirs).sort();
  if (names.length === 0) {
    return {
      appDir: root,
      packages: [],
      subpaths: {},
      consumerCount: 0,
      offenderCount: 0,
      gate: evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 1 }),
      violations: [],
    };
  }

  const subpaths = Object.fromEntries(
    names.map((name) => [
      name,
      packageSubpaths(
        readManifest(packageDirs[name]!),
        path.relative(root, packageDirs[name]!).split(path.sep).join('/'),
      ),
    ]),
  );
  const exported = (pkg: string, specifier: string): boolean =>
    (matchingSubpath(subpaths[pkg]!, `.${specifier.slice(pkg.length)}`)?.targets.length ?? 0) > 0;
  const open = new Set(
    names.filter(
      (name) =>
        subpaths[name]!.some(({ key, targets }) => key === './*' && targets.length > 0) &&
        subpaths[name]!.every(({ targets }) => targets.length > 0),
    ),
  );
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const analyze = createImportAnalyzer(root, { resolve: options.resolve ?? false });
  const consumers = new Set<string>();
  const offenders = new Set<string>();
  const violations: WorkspacePackageViolation[] = [];
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
      const pkg = matchPackage(imp.specifier, names);
      if (pkg === null || open.has(pkg)) continue;
      consumers.add(file.relativePath);
      if (imp.specifier !== pkg && !exported(pkg, imp.specifier)) {
        offenders.add(file.relativePath);
        violations.push({ file: file.relativePath, specifier: imp.specifier, package: pkg });
      }
    }
  }

  return {
    appDir: root,
    packages: names,
    subpaths,
    consumerCount: consumers.size,
    offenderCount: offenders.size,
    gate: evaluateGate({
      roleFileCount: consumers.size,
      violatingFileCount: offenders.size,
      roleConfidence: 1,
    }),
    violations: violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier),
    ),
  };
}
