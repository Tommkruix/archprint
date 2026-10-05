import { describe, expect, it } from 'vitest';
import { mergeNoRestrictedImports } from '../../src/generator/eslint-scope.js';

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
