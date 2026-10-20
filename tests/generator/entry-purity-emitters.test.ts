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
    imports: [],
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
  it('forbids importing a framework entry, sparing entries, tests, allowed importers and known imports', () => {
    const rule = toDependencyCruiserEntryPurity(
      { ...analysis(200, 1), imports: [{ file: 'app/legacy/page.tsx', importer: 'lib/old.ts' }] },
      () => ['lib/allowed.ts'],
    ).forbidden[0]!;
    expect(rule.name).toBe('no-import-framework-entry');
    const exempt = (side: string | string[] | undefined, file: string): boolean =>
      [side ?? []].flat().some((source) => new RegExp(source).test(file));
    expect(exempt(rule.from.pathNot, 'app/dashboard/page.tsx')).toBe(true);
    expect(exempt(rule.from.pathNot, 'lib/util.test.ts')).toBe(true);
    expect(exempt(rule.from.pathNot, 'lib/allowed.ts')).toBe(true);
    expect(exempt(rule.from.pathNot, 'lib/new.ts')).toBe(false);
    expect(new RegExp(rule.to.path).test('app/dashboard/page.tsx')).toBe(true);
    expect(exempt(rule.to.pathNot, 'app/legacy/page.tsx')).toBe(true);
    expect(exempt(rule.to.pathNot, 'app/dashboard/page.tsx')).toBe(false);
    expect(rule.to.dependencyTypesNot).toEqual(['type-only']);
  });

  it('emits nothing when there are no entries or the rule is below AUTO', () => {
    expect(toDependencyCruiserEntryPurity(analysis(0, 0), () => []).forbidden).toEqual([]);
    expect(toDependencyCruiserEntryPurity(analysis(5, 3), () => []).forbidden).toEqual([]);
  });
});
