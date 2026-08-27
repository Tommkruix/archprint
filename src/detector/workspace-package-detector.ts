import * as path from 'node:path';
import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from '../scanner/workspace-packages.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

export interface WorkspacePackageViolation {
  file: string;
  specifier: string;
  package: string;
}

export interface WorkspacePackageAnalysis {
  appDir: string;
  packages: string[];
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

export function detectWorkspacePackageApi(
  appDir: string,
  options: WorkspacePackageOptions = {},
): WorkspacePackageAnalysis {
  const root = path.resolve(appDir);
  const names = Object.keys(buildWorkspacePackageMap(findWorkspaceRoot(root)));
  if (names.length === 0) {
    return {
      appDir: root,
      packages: [],
      consumerCount: 0,
      offenderCount: 0,
      gate: evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 1 }),
      violations: [],
    };
  }

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
      if (pkg === null) continue;
      consumers.add(file.relativePath);
      if (imp.specifier !== pkg) {
        offenders.add(file.relativePath);
        violations.push({ file: file.relativePath, specifier: imp.specifier, package: pkg });
      }
    }
  }

  return {
    appDir: root,
    packages: names.sort(),
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
