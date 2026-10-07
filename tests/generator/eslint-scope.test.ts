import { describe, expect, it } from 'vitest';
import { withMinedExemptions } from '../../src/generator/console-isolation-emitters.js';
import { exemptImporters } from '../../src/generator/deep-relative-emitters.js';
import {
  exemptionGlobs,
  literalGlob,
  mergeNoRestrictedImports,
} from '../../src/generator/eslint-scope.js';

const block = (regex: string, ignores?: string[]) => ({
  ...(ignores ? { ignores } : {}),
  rules: { 'no-restricted-imports': ['error', { patterns: [{ regex, message: regex }] }] },
});

const regexes = (merged: { rules: Record<string, unknown> }): string[] =>
  (merged.rules['no-restricted-imports'] as [string, { patterns: { regex: string }[] }])[1].patterns
    .map((pattern) => pattern.regex)
    .sort();

describe('mergeNoRestrictedImports', () => {
  it('puts every family in one base block and skips files any family excepts', () => {
    const [base] = mergeNoRestrictedImports([
      block('DEEP', ['src/a.ts']),
      block('TEST'),
      block('WORKSPACE', ['src/b.ts']),
      null,
    ]);
    expect(regexes(base!)).toEqual(['DEEP', 'TEST', 'WORKSPACE']);
    expect(base!.ignores).toEqual(
      expect.arrayContaining(['src/a.ts', 'src/b.ts', '**/__tests__/**']),
    );
  });

  it('still applies the other families to a file excepted by only one of them', () => {
    const [, ...overrides] = mergeNoRestrictedImports([
      block('DEEP', ['src/a.ts', 'src/both.ts']),
      block('TEST', ['src/both.ts']),
      block('WORKSPACE', ['src/b.ts']),
    ]);
    const byFile = new Map(
      overrides.flatMap((o) => (o.files ?? []).map((file) => [file, regexes(o)])),
    );
    expect(byFile.get('src/a.ts')).toEqual(['TEST', 'WORKSPACE']);
    expect(byFile.get('src/b.ts')).toEqual(['DEEP', 'TEST']);
    expect(byFile.get('src/both.ts')).toEqual(['WORKSPACE']);
  });

  it('adds no block for a file every family excepts', () => {
    const merged = mergeNoRestrictedImports([
      block('DEEP', ['src/a.ts']),
      block('TEST', ['src/a.ts']),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('returns nothing when no block carries patterns', () => {
    expect(mergeNoRestrictedImports([null, null])).toEqual([]);
  });
});

describe('literal file paths in ESLint globs', () => {
  it('escapes the folder names web frameworks use for routes', () => {
    expect(literalGlob('app/(shop)/@modal/[[...slug]]/route.ts')).toBe(
      'app/[(]shop[)]/[@]modal/[[][[]...slug[]][]]/route.ts',
    );
    expect(literalGlob('src/{legacy}/x.ts')).toBe('src/\\{legacy\\}/x.ts');
    expect(literalGlob('!draft.ts')).toBe('\\!draft.ts');
    expect(literalGlob('src/plain/file.ts')).toBe('src/plain/file.ts');
  });

  it('escapes the files the detectors exempt, and leaves their globs alone', () => {
    const violation = { file: 'app/api/[id]/route.ts' };
    expect(withMinedExemptions(['**/test/**'], [violation])).toEqual([
      '**/test/**',
      'app/api/[[]id[]]/route.ts',
    ]);
    expect(exemptImporters([violation])).toEqual({ ignores: ['app/api/[[]id[]]/route.ts'] });
  });

  it('prefixes a file glob with the escaped app path, never a ** glob', () => {
    expect(exemptionGlobs('app/[[]id[]]/x.ts', 'apps/(web)')).toEqual([
      'apps/[(]web[)]/app/[[]id[]]/x.ts',
      'app/[[]id[]]/x.ts',
    ]);
    expect(exemptionGlobs('**/test/**', 'apps/web')).toEqual(['**/test/**']);
    expect(exemptionGlobs('app/x.ts', '.')).toEqual(['app/x.ts']);
  });
});
