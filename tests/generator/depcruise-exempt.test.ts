import { describe, expect, it } from 'vitest';
import { exemptDepcruiseFrom } from '../../src/generator/depcruise-exempt.js';

describe('exemptDepcruiseFrom', () => {
  it('returns the base pattern unchanged when there are no tolerated violations', () => {
    expect(exemptDepcruiseFrom('node_modules', [])).toBe('node_modules');
  });

  it('appends anchored, escaped regexes for the tolerated files', () => {
    expect(
      exemptDepcruiseFrom('node_modules', [{ file: 'src/a.ts' }, { file: 'src/b.tsx' }]),
    ).toEqual(['node_modules', '(^|/)src/a\\.ts$', '(^|/)src/b\\.tsx$']);
  });

  it('exempts the tolerated file under the app folder, never a file whose path merely ends the same', () => {
    const [, tolerated] = exemptDepcruiseFrom('node_modules', [{ file: 'lib/legacy.ts' }]);
    const pattern = new RegExp(tolerated!);
    expect(pattern.test('lib/legacy.ts')).toBe(true);
    expect(pattern.test('apps/web/lib/legacy.ts')).toBe(true);
    expect(pattern.test('src/lib/legacy.ts')).toBe(true);
    expect(pattern.test('mylib/legacy.ts')).toBe(false);
  });
});
