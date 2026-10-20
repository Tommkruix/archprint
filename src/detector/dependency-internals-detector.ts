import { builtinModules } from 'node:module';
import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import { isPackageInternal, packageName } from '../scanner/package-name.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import * as path from 'node:path';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const BUILTINS = new Set(builtinModules);

export interface DependencyInternalViolation {
  file: string;
  specifier: string;
}

export interface DependencyInternalsAnalysis {
  appDir: string;
  externalImporterCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: DependencyInternalViolation[];
}

export interface DependencyInternalsOptions {
  resolve?: boolean;
}

export function detectDependencyInternals(
  appDir: string,
  options: DependencyInternalsOptions = {},
): DependencyInternalsAnalysis {
  const root = path.resolve(appDir);
  const resolve = options.resolve ?? false;
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const aliasPrefixes = Object.keys(buildWorkspaceMap(root)).map((key) =>
    key.replace(/\/?\*$/, ''),
  );
  const analyze = createImportAnalyzer(root, { resolve });

  const externalImporters = new Set<string>();
  const offenders = new Set<string>();
  const violations: DependencyInternalViolation[] = [];
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
      if (isPackageInternal(imp.specifier, name)) {
        offenders.add(file.relativePath);
        violations.push({ file: file.relativePath, specifier: imp.specifier });
      }
    }
  }

  return {
    appDir: root,
    externalImporterCount: externalImporters.size,
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
