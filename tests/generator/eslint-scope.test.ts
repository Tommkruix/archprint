import { describe, expect, it } from 'vitest';
import { mergeNoRestrictedImports } from '../../src/generator/eslint-scope.js';

const block = (regex: string, ignores?: string[]) => ({
  ...(ignores ? { ignores } : {}),
  rules: { 'no-restricted-imports': ['error', { patterns: [{ regex, message: regex }] }] },
});

describe('mergeNoRestrictedImports', () => {
  it('merges patterns from every family into one block so none is clobbered', () => {
    const merged = mergeNoRestrictedImports([
      block('DEEP', ['src/a.ts']),
      block('TEST'),
      block('WORKSPACE', ['src/b.ts']),
      null,
    ]);
    const rule = merged!.rules['no-restricted-imports'] as [
      string,
      { patterns: { regex: string }[] },
    ];
    expect(rule[1].patterns.map((p) => p.regex).sort()).toEqual(['DEEP', 'TEST', 'WORKSPACE']);
    expect(merged!.ignores).toContain('src/a.ts');
    expect(merged!.ignores).toContain('src/b.ts');
    expect(merged!.ignores).toContain('**/__tests__/**');
  });

  it('returns null when no block carries patterns', () => {
    expect(mergeNoRestrictedImports([null, null])).toBeNull();
  });
});
