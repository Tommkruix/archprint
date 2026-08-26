import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type FeatureSliceGroup,
  toDependencyCruiserFeatureSlice,
} from '../../src/index.js';

function group(
  container: string,
  sliceFileCount: number,
  crossImporterCount: number,
): FeatureSliceGroup {
  return {
    container,
    sliceCount: 3,
    sliceFileCount,
    crossImporterCount,
    gate: evaluateGate({
      roleFileCount: sliceFileCount,
      violatingFileCount: crossImporterCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

describe('toDependencyCruiserFeatureSlice', () => {
  it('emits a cross-slice rule that forbids the other slices via a $1 back-reference', () => {
    const config = toDependencyCruiserFeatureSlice([group('src/features', 40, 0)]);
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('no-cross-slice-src-features');
    expect(rule.from.path).toBe('^src/features/([^/]+)/');
    expect(rule.to.path).toBe('^src/features/([^/]+)/');
    expect(rule.to.pathNot).toBe('^src/features/$1/');
  });

  it('emits only AUTO groups by default, and SUGGEST when asked', () => {
    const groups = [group('src/features', 40, 0), group('src/modules', 20, 2)];
    expect(groups.map((g) => g.gate.status)).toEqual(['AUTO', 'SUGGEST']);
    expect(toDependencyCruiserFeatureSlice(groups).forbidden).toHaveLength(1);
    expect(toDependencyCruiserFeatureSlice(groups, ['AUTO', 'SUGGEST']).forbidden).toHaveLength(2);
  });
});
