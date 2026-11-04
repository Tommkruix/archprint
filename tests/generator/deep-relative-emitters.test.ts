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
  it('emits the import-style rule over deep relatives, type-only imports included, when clean (AUTO)', () => {
    const config = toEslintDeepRelative(analysis(40, 0));
    expect(config?.name).toBe('import-style');
    expect(config?.check).toEqual({ kind: 'import', regex: '^(\\.\\./){3,}', typeImports: true });
  });

  it('emits null with no relative imports or below AUTO', () => {
    expect(toEslintDeepRelative(analysis(0, 0))).toBeNull();
    expect(toEslintDeepRelative(analysis(5, 3))).toBeNull();
  });

  it('exempts the tests the detector skipped and the tolerated deep-relative importers the gate accepted', () => {
    const config = toEslintDeepRelative(analysis(200, 1, ['src/a/b/c/deep.ts']));
    expect(config!.ignores).toContain('src/a/b/c/deep.ts');
    expect(config!.ignores).toContain('**/__tests__/**');
  });
});
