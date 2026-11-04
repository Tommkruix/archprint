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

describe('toDependencyCruiserAppIsolation in an app below the repository root', () => {
  it('prefixes the app path and exempts the known and the allowed cross-app importers', () => {
    const known = {
      ...group('apps', 200, 1),
      violations: [{ file: 'apps/a/x.ts', target: 'apps/b/y.ts' }],
    };
    const allowed = (rule: string) => (rule === 'no-cross-app-apps' ? ['apps/a/z.ts'] : []);
    const [rule] = toDependencyCruiserAppIsolation([known], ['AUTO'], 'web', allowed).forbidden;
    expect(rule!.from.path).toBe('^web/apps/([^/]+)/');
    expect(rule!.to.pathNot).toBe('^web/apps/$1/');
    expect(rule!.from.pathNot).toEqual(['(^|/)apps/a/x\\.ts$', '(^|/)apps/a/z\\.ts$']);
  });

  it('adds no exemption when nothing is known or allowed', () => {
    const [rule] = toDependencyCruiserAppIsolation([group('apps', 40, 0)]).forbidden;
    expect(rule!.from.pathNot).toBeUndefined();
  });
});
