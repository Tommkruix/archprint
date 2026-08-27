import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type PhantomDependencyAnalysis,
  toDependencyCruiserPhantomDependencies,
} from '../../src/index.js';

function analysis(externalImporterCount: number, offenderCount: number): PhantomDependencyAnalysis {
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

describe('toDependencyCruiserPhantomDependencies', () => {
  it('emits a rule keyed on undeclared dependency types when clean (AUTO)', () => {
    const config = toDependencyCruiserPhantomDependencies(analysis(40, 0));
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('no-phantom-dependencies');
    expect(rule.to.dependencyTypes).toEqual(['npm-no-pkg', 'npm-unknown']);
  });

  it('emits nothing with no external imports or below AUTO', () => {
    expect(toDependencyCruiserPhantomDependencies(analysis(0, 0)).forbidden).toEqual([]);
    expect(toDependencyCruiserPhantomDependencies(analysis(5, 3)).forbidden).toEqual([]);
  });
});
