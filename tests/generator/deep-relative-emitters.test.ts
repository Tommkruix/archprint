import { describe, expect, it } from 'vitest';
import { type DeepRelativeAnalysis, evaluateGate, toEslintDeepRelative } from '../../src/index.js';

function analysis(
  relativeImporterCount: number,
  offenderCount: number,
  files: string[] = [],
): DeepRelativeAnalysis {
  return {
    appDir: 'x',
    relativeImporterCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: relativeImporterCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: files.map((file) => ({ file, specifier: '../../../deep' })),
  };
}

describe('toEslintDeepRelative', () => {
  it('emits a no-restricted-imports pattern for deep relatives when clean (AUTO)', () => {
    const config = toEslintDeepRelative(analysis(40, 0));
    expect(config).not.toBeNull();
    const rule = config!.rules['no-restricted-imports'];
    expect(rule[0]).toBe('error');
    expect(rule[1].patterns[0]!.regex).toBe('^(\\.\\./){3,}');
  });

  it('emits null with no relative imports or below AUTO', () => {
    expect(toEslintDeepRelative(analysis(0, 0))).toBeNull();
    expect(toEslintDeepRelative(analysis(5, 3))).toBeNull();
  });

  it('exempts the tolerated deep-relative importers the gate accepted', () => {
    const config = toEslintDeepRelative(analysis(200, 1, ['src/a/b/c/deep.ts']));
    expect(config!.ignores).toEqual(['src/a/b/c/deep.ts']);
  });

  it('omits ignores when there are no tolerated importers', () => {
    expect(toEslintDeepRelative(analysis(40, 0))!.ignores).toBeUndefined();
  });
});
