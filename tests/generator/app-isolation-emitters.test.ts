import { describe, expect, it } from 'vitest';
import {
  type AppIsolationGroup,
  evaluateGate,
  toDependencyCruiserAppIsolation,
} from '../../src/index.js';

function group(
  container: string,
  appFileCount: number,
  crossImporterCount: number,
): AppIsolationGroup {
  return {
    container,
    appCount: 2,
    appFileCount,
    crossImporterCount,
    gate: evaluateGate({
      roleFileCount: appFileCount,
      violatingFileCount: crossImporterCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

describe('toDependencyCruiserAppIsolation', () => {
  it('emits a cross-app rule that forbids the other apps via a $1 back-reference', () => {
    const config = toDependencyCruiserAppIsolation([group('apps', 40, 0)]);
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('no-cross-app-apps');
    expect(rule.from.path).toBe('^apps/([^/]+)/');
    expect(rule.to.path).toBe('^apps/([^/]+)/');
    expect(rule.to.pathNot).toBe('^apps/$1/');
  });

  it('emits only AUTO groups by default, and SUGGEST when asked', () => {
    const groups = [group('apps', 40, 0), group('services', 20, 2)];
    expect(groups.map((g) => g.gate.status)).toEqual(['AUTO', 'SUGGEST']);
    expect(toDependencyCruiserAppIsolation(groups).forbidden).toHaveLength(1);
    expect(toDependencyCruiserAppIsolation(groups, ['AUTO', 'SUGGEST']).forbidden).toHaveLength(2);
  });
});
