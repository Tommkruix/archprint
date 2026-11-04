import { describe, expect, it } from 'vitest';
import { exemptDepcruiseFrom } from '../../src/generator/depcruise-exempt.js';

describe('exemptDepcruiseFrom', () => {
  it('returns the base pattern unchanged when there are no tolerated violations', () => {
    expect(exemptDepcruiseFrom('node_modules', [], '.')).toBe('node_modules');
  });

  it('adds one escaped regex for the tolerated files, each once, in a stable order', () => {
    expect(
      exemptDepcruiseFrom(
        'node_modules',
        [{ file: 'src/b.tsx' }, { file: 'src/a.ts' }, { file: 'src/a.ts' }],
        '.',
      ),
    ).toEqual(['node_modules', '^(?:src/a\\.ts|src/b\\.tsx)$']);
  });

  it('exempts exactly the tolerated file, never one whose path only ends the same', () => {
    const [, tolerated] = exemptDepcruiseFrom('node_modules', [{ file: 'lib/legacy.ts' }], '.');
    const pattern = new RegExp(tolerated!);
    expect(pattern.test('lib/legacy.ts')).toBe(true);
    expect(pattern.test('src/lib/legacy.ts')).toBe(false);
    expect(pattern.test('mylib/legacy.ts')).toBe(false);
  });

  it('exempts the file from the repository root or inside its app, never in a sibling app', () => {
    const [, tolerated] = exemptDepcruiseFrom(
      'node_modules',
      [{ file: 'lib/legacy.ts' }],
      'apps/web',
    );
    const pattern = new RegExp(tolerated!);
    expect(pattern.test('apps/web/lib/legacy.ts')).toBe(true);
    expect(pattern.test('lib/legacy.ts')).toBe(true);
    expect(pattern.test('apps/api/lib/legacy.ts')).toBe(false);
    expect(pattern.test('apps/web/src/lib/legacy.ts')).toBe(false);
  });
});
