import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type TestIsolationAnalysis,
  toDependencyCruiserTestIsolation,
} from '../../src/index.js';

function analysis(
  productionFileCount: number,
  offenderCount: number,
  testFileCount: number,
): TestIsolationAnalysis {
  return {
    appDir: 'x',
    productionFileCount,
    testFileCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: productionFileCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

describe('toDependencyCruiserTestIsolation', () => {
  it('emits a not-to-test rule when the repo cleanly isolates tests (AUTO)', () => {
    const config = toDependencyCruiserTestIsolation(analysis(40, 0, 3));
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('not-to-test');
    expect(rule.from.pathNot).toBe('\\.(test|spec)\\.(ts|tsx)$');
    expect(rule.to.path).toBe('\\.(test|spec)\\.(ts|tsx)$');
  });

  it('emits nothing when the app has no test files', () => {
    expect(toDependencyCruiserTestIsolation(analysis(40, 0, 0)).forbidden).toEqual([]);
  });

  it('emits nothing when the rule is not enforceable (below AUTO)', () => {
    expect(toDependencyCruiserTestIsolation(analysis(5, 3, 2)).forbidden).toEqual([]);
  });
});
