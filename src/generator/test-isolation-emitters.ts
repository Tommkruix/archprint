import type { TestIsolationAnalysis } from '../detector/test-isolation-detector.js';

const TEST_PATH = '\\.(test|spec)\\.(ts|tsx)$';

export interface NotToTestRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  /** Production modules (paths that are not test files). */
  from: { pathNot: string };
  /** Test files. */
  to: { path: string };
}

export interface NotToTestConfig {
  forbidden: NotToTestRule[];
}

/**
 * Emit inferred test isolation as a dependency-cruiser `forbidden` rule: a production module may not import a
 * test or spec file. Returns an empty ruleset unless the analysis is enforceable (AUTO) and the app actually
 * has test files.
 */
export function toDependencyCruiserTestIsolation(analysis: TestIsolationAnalysis): NotToTestConfig {
  if (analysis.testFileCount === 0 || analysis.gate.status !== 'AUTO') return { forbidden: [] };
  const conform = analysis.productionFileCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: 'not-to-test',
        comment: `Archprint inferred test isolation: ${conform}/${analysis.productionFileCount} production files do not import a test file; importing tests from production code is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: { pathNot: TEST_PATH },
        to: { path: TEST_PATH },
      },
    ],
  };
}
