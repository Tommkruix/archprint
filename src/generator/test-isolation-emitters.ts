import type { TestIsolationAnalysis } from '../detector/test-isolation-detector.js';
import { withMinedExemptions } from './console-isolation-emitters.js';
import type { EslintFamilyRule } from './eslint-family-rules.js';
import { testGlobs } from './eslint-scope.js';
import {
  type AllowedFor,
  exemptDepcruiseFrom,
  noneAllowed,
  testPaths,
  toleratedFiles,
} from './depcruise-exempt.js';

export interface NotToTestRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { pathNot: string | string[] };
  to: { path: string | string[] };
}

export interface NotToTestConfig {
  forbidden: NotToTestRule[];
}

export function toDependencyCruiserTestIsolation(
  analysis: TestIsolationAnalysis,
  appPath = '.',
  allowedFor: AllowedFor = noneAllowed,
  setupFiles: readonly string[] = [],
): NotToTestConfig {
  if (analysis.testFileCount === 0 || analysis.gate.status !== 'AUTO') return { forbidden: [] };
  const tests = testPaths(setupFiles, appPath);
  const conform = analysis.productionFileCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: 'not-to-test',
        comment: `Archprint inferred test isolation: ${conform}/${analysis.productionFileCount} production files do not import a test file; importing tests from production code is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: {
          pathNot: exemptDepcruiseFrom(
            tests,
            toleratedFiles(analysis.violations, allowedFor('test-isolation')),
            appPath,
          ),
        },
        to: { path: tests.length === 1 ? tests[0]! : tests },
      },
    ],
  };
}

export function toEslintTestIsolation(
  analysis: TestIsolationAnalysis,
  setupFiles: readonly string[] = [],
): EslintFamilyRule | null {
  if (analysis.testFileCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    name: 'test-isolation',
    message: 'Do not import a test file from production code.',
    ignores: withMinedExemptions(testGlobs(setupFiles), analysis.violations),
    check: { kind: 'import', regex: '\\.(test|spec)(\\.|$)', typeImports: false },
  };
}
