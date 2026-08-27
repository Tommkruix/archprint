import { describe, expect, it } from 'vitest';
import {
  type EntryPurityAnalysis,
  evaluateGate,
  toDependencyCruiserEntryPurity,
} from '../../src/index.js';

function analysis(entryCount: number, offenderCount: number): EntryPurityAnalysis {
  return {
    appDir: 'x',
    entryCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: entryCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

describe('toDependencyCruiserEntryPurity', () => {
  it('emits a rule forbidding imports of framework entries when clean (AUTO)', () => {
    const config = toDependencyCruiserEntryPurity(analysis(40, 0));
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('no-import-framework-entry');
    expect(rule.from.pathNot).toBe('node_modules');
    expect(rule.to.path).toContain('page');
  });

  it('emits nothing when there are no entries or the rule is below AUTO', () => {
    expect(toDependencyCruiserEntryPurity(analysis(0, 0)).forbidden).toEqual([]);
    expect(toDependencyCruiserEntryPurity(analysis(5, 3)).forbidden).toEqual([]);
  });
});
