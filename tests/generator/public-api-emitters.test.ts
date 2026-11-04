import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type PublicApiGroup,
  toDependencyCruiserPublicApi,
} from '../../src/index.js';

function group(
  dir: string,
  consumerCount: number,
  deepImporterCount: number,
  files: string[] = [],
): PublicApiGroup {
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
    violations: files.map((file) => ({ file, target: `${dir}/internal.ts` })),
  };
}

describe('toDependencyCruiserPublicApi', () => {
  it('emits a deep-import forbidden rule scoped to the group, excluding the barrel and tests', () => {
    const config = toDependencyCruiserPublicApi([group('features/auth', 40, 0)]);
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('no-deep-import-features-auth');
    expect(rule.severity).toBe('error');
    expect(rule.from.pathNot).toContain('^features/auth/');
    expect((rule.from.pathNot as string[]).some((p) => p.includes('__tests__'))).toBe(true);
    expect(rule.to.path).toBe('^features/auth/');
    expect(rule.to.pathNot).toBe('^features/auth/index\\.(ts|tsx)$');
  });

  it('exempts the tolerated deep importers the gate accepted', () => {
    const config = toDependencyCruiserPublicApi([
      group('features/auth', 200, 1, ['src/legacy.ts']),
    ]);
    expect(config.forbidden[0]!.from.pathNot).toContain('^(?:src/legacy\\.ts)$');
  });

  it('emits only AUTO groups by default, and SUGGEST when asked', () => {
    const groups = [group('features/auth', 40, 0), group('features/billing', 20, 2)];
    expect(groups.map((g) => g.gate.status)).toEqual(['AUTO', 'SUGGEST']);
    expect(toDependencyCruiserPublicApi(groups).forbidden).toHaveLength(1);
    expect(toDependencyCruiserPublicApi(groups, ['AUTO', 'SUGGEST']).forbidden).toHaveLength(2);
  });
});

describe('toDependencyCruiserPublicApi in an app below the repository root', () => {
  it('prefixes the app path and exempts the known and the allowed deep importers', () => {
    const allowed = (rule: string) =>
      rule === 'no-deep-import-features-auth' ? ['src/allowed.ts'] : [];
    const [rule] = toDependencyCruiserPublicApi(
      [group('features/auth', 200, 1, ['src/known.ts'])],
      ['AUTO'],
      'apps/web',
      allowed,
    ).forbidden;
    expect(rule!.to.path).toBe('^apps/web/features/auth/');
    expect(rule!.to.pathNot).toBe('^apps/web/features/auth/index\\.(ts|tsx)$');
    expect(rule!.from.pathNot).toEqual(
      expect.arrayContaining([
        '^apps/web/features/auth/',
        '^apps/web/(?:src/allowed\\.ts|src/known\\.ts)$',
      ]),
    );
  });
});
