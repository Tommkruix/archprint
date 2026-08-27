import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type PublicApiGroup,
  toDependencyCruiserPublicApi,
} from '../../src/index.js';

function group(dir: string, consumerCount: number, deepImporterCount: number): PublicApiGroup {
  return {
    dir,
    internalCount: 4,
    consumerCount,
    deepImporterCount,
    gate: evaluateGate({
      roleFileCount: consumerCount,
      violatingFileCount: deepImporterCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

describe('toDependencyCruiserPublicApi', () => {
  it('emits a deep-import forbidden rule scoped to the group, barrel excluded', () => {
    const config = toDependencyCruiserPublicApi([group('features/auth', 40, 0)]);
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('no-deep-import-features-auth');
    expect(rule.severity).toBe('error');
    expect(rule.from.pathNot).toBe('^features/auth/');
    expect(rule.to.path).toBe('^features/auth/');
    expect(rule.to.pathNot).toBe('^features/auth/index\\.(ts|tsx)$');
  });

  it('emits only AUTO groups by default, and SUGGEST when asked', () => {
    const groups = [group('features/auth', 40, 0), group('features/billing', 20, 2)];
    expect(groups.map((g) => g.gate.status)).toEqual(['AUTO', 'SUGGEST']);
    expect(toDependencyCruiserPublicApi(groups).forbidden).toHaveLength(1);
    expect(toDependencyCruiserPublicApi(groups, ['AUTO', 'SUGGEST']).forbidden).toHaveLength(2);
  });
});
