import { describe, expect, it } from 'vitest';
import { withMinedExemptions } from '../../src/generator/console-isolation-emitters.js';
import { exemptionGlobs, literalGlob } from '../../src/generator/eslint-scope.js';

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
