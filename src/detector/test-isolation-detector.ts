import { buildImportGraph } from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

export interface TestImportViolation {
  /** The production file that imports a test file. */
  file: string;
  /** The test file it imports. */
  target: string;
}

export interface TestIsolationAnalysis {
  appDir: string;
  /** Non-test source files (the role sample). */
  productionFileCount: number;
  /** Test files present in the app. */
  testFileCount: number;
  /** Production files that import a test file. */
  offenderCount: number;
  gate: GateResult;
  violations: TestImportViolation[];
}

export interface TestIsolationDetectorOptions {
  resolve?: boolean;
}

/**
 * Infer test isolation: production (non-test) files should not import test or spec files. Builds the graph
 * with test files kept as nodes, counts production files that import a test file, and runs the count through
 * the Wilson gate, so "production code must not import test files" becomes enforceable (AUTO) when the repo
 * already respects it at scale. The rule is only meaningful when `testFileCount > 0`; consumers ignore it
 * otherwise (a repo with no tests cannot import one).
 */
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
