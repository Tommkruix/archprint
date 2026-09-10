import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type TestIsolationAnalysis,
  toDependencyCruiserTestIsolation,
  toEslintTestIsolation,
} from '../../src/index.js';

function analysis(
  productionFileCount: number,
  offenderCount: number,
  testFileCount: number,
  files: string[] = [],
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
    violations: files.map((file) => ({ file, target: 'x.test.ts' })),
  };
}

const TEST_PATH =
  '(\\.(test|spec|e2e-spec|e2e)\\.(ts|tsx)$)|((^|/)(__tests__|__mocks__|e2e|cypress|playwright|test|tests)/)';

describe('toDependencyCruiserTestIsolation', () => {
  it('emits a not-to-test rule matching the full test role when clean (AUTO)', () => {
    const config = toDependencyCruiserTestIsolation(analysis(40, 0, 3));
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('not-to-test');
    expect(rule.from.pathNot).toBe(TEST_PATH);
    expect(rule.to.path).toBe(TEST_PATH);
  });

  it('emits nothing when the app has no test files', () => {
    expect(toDependencyCruiserTestIsolation(analysis(40, 0, 0)).forbidden).toEqual([]);
  });

  it('exempts the tolerated importers the gate accepted via from.pathNot', () => {
    const config = toDependencyCruiserTestIsolation(analysis(200, 1, 3, ['src/leak.ts']));
    expect(config.forbidden[0]!.from.pathNot).toEqual([TEST_PATH, 'src/leak\\.ts$']);
  });

  it('emits nothing when the rule is not enforceable (below AUTO)', () => {
    expect(toDependencyCruiserTestIsolation(analysis(5, 3, 2)).forbidden).toEqual([]);
  });
});

describe('toEslintTestIsolation', () => {
  it('emits an eslint no-restricted-imports block banning test paths when clean (AUTO)', () => {
    const config = toEslintTestIsolation(analysis(40, 0, 3));
    expect(config?.rules['no-restricted-imports']).toBeDefined();
    expect(config?.ignores).toContain('**/*.{test,spec,e2e-spec,e2e}.{ts,tsx}');
    expect(config?.ignores).toContain('**/__tests__/**');
  });

  it('emits null with no test files or below AUTO', () => {
    expect(toEslintTestIsolation(analysis(40, 0, 0))).toBeNull();
    expect(toEslintTestIsolation(analysis(5, 3, 2))).toBeNull();
  });
});
