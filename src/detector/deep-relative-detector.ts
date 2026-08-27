import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import * as path from 'node:path';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const DEEP_RELATIVE = /^(\.\.\/){3,}/;

export interface DeepRelativeViolation {
  file: string;
  specifier: string;
}

export interface DeepRelativeAnalysis {
  appDir: string;
  relativeImporterCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: DeepRelativeViolation[];
}

export interface DeepRelativeOptions {
  resolve?: boolean;
}

export function detectDeepRelativeImports(
  appDir: string,
  options: DeepRelativeOptions = {},
): DeepRelativeAnalysis {
  const root = path.resolve(appDir);
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const analyze = createImportAnalyzer(root, { resolve: options.resolve ?? false });

  const relativeImporters = new Set<string>();
  const offenders = new Set<string>();
  const violations: DeepRelativeViolation[] = [];
  for (const file of files) {
    let imports: ResolvedImport[];
    try {
      imports = analyze(file.absolutePath);
    } catch {
      /* v8 ignore next -- defensive: analyze throws only on an unreadable/malformed source file */
      imports = [];
    }
    for (const imp of imports) {
      if (!imp.specifier.startsWith('.')) continue;
      relativeImporters.add(file.relativePath);
      if (DEEP_RELATIVE.test(imp.specifier)) {
        offenders.add(file.relativePath);
        violations.push({ file: file.relativePath, specifier: imp.specifier });
      }
    }
  }

  return {
    appDir: root,
    relativeImporterCount: relativeImporters.size,
    offenderCount: offenders.size,
    gate: evaluateGate({
      roleFileCount: relativeImporters.size,
      violatingFileCount: offenders.size,
      roleConfidence: 1,
    }),
    violations: violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier),
    ),
  };
}
