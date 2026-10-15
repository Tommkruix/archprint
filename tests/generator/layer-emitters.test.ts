import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type LayerBoundary,
  toDependencyCruiser,
  toEslintBoundaries,
} from '../../src/index.js';

function boundary(from: string, to: string, roleFileCount: number): LayerBoundary {
  const gate = evaluateGate({ roleFileCount, violatingFileCount: 0, roleConfidence: 1 });
  return {
    id: 'AP-LAYER',
    name: `no-import:${from}->${to}`,
    from,
    to,
    fromDirs: [from],
    toDirs: [to],
    description: 'x',
    stats: {
      roleFileCount,
      conformingFileCount: roleFileCount,
      violatingFileCount: 0,
      ratio: 1,
      roleConfidence: 1,
    },
    gate,
    violations: [],
    reverseFlow: 20,
  };
}

describe('toDependencyCruiser', () => {
  it('emits one forbidden rule per AUTO boundary, scoped to the folders the layers were scanned in', () => {
    const rule = toDependencyCruiser([
      { ...boundary('lib', 'app', 40), fromDirs: ['lib', 'src/lib'], toDirs: ['app', 'src/app'] },
    ]).forbidden[0]!;
    expect(rule.name).toBe('no-lib-to-app');
    expect(rule.severity).toBe('error');
    const from = new RegExp(rule.from.path);
    expect(from.test('lib/db.ts')).toBe(true);
    expect(from.test('src/lib/db.ts')).toBe(true);
    expect(from.test('app/(dash)/lib/db.ts')).toBe(false);
    expect(from.test('packages/ui/lib/db.ts')).toBe(false);
    expect(from.test('node_modules/@scope/lib/index.js')).toBe(false);
    expect(new RegExp(rule.to.path).test('src/app/page.tsx')).toBe(true);
  });

  it('matches the layer under the app folder when the app is not where the config lives', () => {
    const rule = toDependencyCruiser([boundary('lib', 'app', 40)], ['AUTO'], 'apps\\web')
      .forbidden[0]!;
    const from = new RegExp(rule.from.path);
    expect(from.test('apps/web/lib/db.ts')).toBe(true);
    expect(from.test('lib/db.ts')).toBe(false);
    expect(from.test('apps/admin/lib/db.ts')).toBe(false);
  });

  it('exempts the known violators and test files, and ignores type-only imports', () => {
    const leaky = {
      ...boundary('lib', 'app', 40),
      violations: [{ file: 'lib/legacy.ts', specifier: '../app/page' }],
    };
    const rule = toDependencyCruiser([leaky]).forbidden[0]!;
    const exempt = [rule.from.pathNot ?? []].flat().map((source) => new RegExp(source));
    const isExempt = (file: string): boolean => exempt.some((pattern) => pattern.test(file));
    expect(isExempt('lib/legacy.ts')).toBe(true);
    expect(isExempt('lib/db.test.ts')).toBe(true);
    expect(isExempt('lib/db.ts')).toBe(false);
    expect(rule.to.dependencyTypesNot).toEqual(['type-only']);
  });

  it('emits only AUTO boundaries by default, and SUGGEST when asked', () => {
    const list = [boundary('a', 'b', 40), boundary('c', 'd', 10)];
    expect(list.map((entry) => entry.gate.status)).toEqual(['AUTO', 'SUGGEST']);
    expect(toDependencyCruiser(list).forbidden).toHaveLength(1);
    expect(toDependencyCruiser(list, ['AUTO', 'SUGGEST']).forbidden).toHaveLength(2);
  });
});

describe('toEslintBoundaries', () => {
  it('emits element types and per-layer disallow rules for AUTO boundaries', () => {
    const config = toEslintBoundaries([
      boundary('utils', 'api', 40),
      boundary('utils', 'components', 40),
      boundary('components', 'features', 40),
    ]);
    const elements = config.settings['boundaries/elements'].map((element) => element.type);
    expect(elements).toEqual(['api', 'components', 'features', 'utils']);

    const rules = config.rules['boundaries/element-types'][1].rules;
    expect(config.rules['boundaries/element-types'][1].default).toBe('allow');
    expect(rules.find((rule) => rule.from[0] === 'utils')!.disallow).toEqual(['api', 'components']);
    expect(rules.find((rule) => rule.from[0] === 'components')!.disallow).toEqual(['features']);
  });
});
