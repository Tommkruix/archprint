import { describe, expect, it } from 'vitest';
import {
  type DependencyInternalsAnalysis,
  evaluateGate,
  toDependencyCruiserDependencyInternals,
} from '../../src/index.js';

function analysis(
  externalImporterCount: number,
  offenderCount: number,
): DependencyInternalsAnalysis {
  return {
    appDir: 'x',
    externalImporterCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: externalImporterCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

describe('toDependencyCruiserDependencyInternals', () => {
  it('emits a rule forbidding imports into a package internals directory when clean (AUTO)', () => {
    const config = toDependencyCruiserDependencyInternals(analysis(40, 0));
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('no-dependency-internals');
    expect(rule.from.pathNot).toContain('node_modules');
    expect((rule.from.pathNot as string[]).some((p) => p.includes('__tests__'))).toBe(true);
    expect(rule.to.path).toContain('node_modules/');
    expect(rule.to.path).toContain('src|internal|internals');
    expect(rule.to.path).not.toContain('dist');
  });

  it('emits nothing when no external packages are imported', () => {
    expect(toDependencyCruiserDependencyInternals(analysis(0, 0)).forbidden).toEqual([]);
  });

  it('emits nothing when the rule is not enforceable (below AUTO)', () => {
    expect(toDependencyCruiserDependencyInternals(analysis(5, 3)).forbidden).toEqual([]);
  });
});
