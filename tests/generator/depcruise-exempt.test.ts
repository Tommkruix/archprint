import { describe, expect, it } from 'vitest';
import { exemptDepcruiseFrom } from '../../src/generator/depcruise-exempt.js';

describe('exemptDepcruiseFrom', () => {
  it('returns the base pattern unchanged when there are no tolerated violations', () => {
    expect(exemptDepcruiseFrom('node_modules', [])).toBe('node_modules');
  });

  it('appends anchored, escaped regexes for the tolerated files', () => {
    expect(
      exemptDepcruiseFrom('node_modules', [{ file: 'src/a.ts' }, { file: 'src/b.tsx' }]),
    ).toEqual(['node_modules', 'src/a\\.ts$', 'src/b\\.tsx$']);
  });
});
