import type { TestIsolationAnalysis } from '../detector/test-isolation-detector.js';

const TEST_PATH = '\\.(test|spec)\\.(ts|tsx)$';

export interface NotToTestRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { pathNot: string };
  to: { path: string };
}

export interface NotToTestConfig {
  forbidden: NotToTestRule[];
}

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
