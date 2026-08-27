import { buildImportGraph } from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

export interface TestImportViolation {
  file: string;
  target: string;
}

export interface TestIsolationAnalysis {
  appDir: string;
  productionFileCount: number;
  testFileCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: TestImportViolation[];
}

export interface TestIsolationDetectorOptions {
  resolve?: boolean;
}

export function detectTestIsolation(
  appDir: string,
  options: TestIsolationDetectorOptions = {},
): TestIsolationAnalysis {
  const { root, files, adjacency } = buildImportGraph(appDir, {
    resolve: options.resolve ?? false,
    includeTests: true,
  });

  const isTest = new Set(files.filter((file) => file.role === 'TEST').map((f) => f.relativePath));
  const production = files.filter((file) => file.role !== 'TEST');

  const offenders = new Set<string>();
  const violations: TestImportViolation[] = [];
  for (const file of production) {
    for (const target of adjacency.get(file.relativePath) ?? []) {
      if (isTest.has(target)) {
        offenders.add(file.relativePath);
        violations.push({ file: file.relativePath, target });
      }
    }
  }

  return {
    appDir: root,
    productionFileCount: production.length,
    testFileCount: isTest.size,
    offenderCount: offenders.size,
    gate: evaluateGate({
      roleFileCount: production.length,
      violatingFileCount: offenders.size,
      roleConfidence: 1,
    }),
    violations: violations.sort((a, b) => a.file.localeCompare(b.file)),
  };
}
