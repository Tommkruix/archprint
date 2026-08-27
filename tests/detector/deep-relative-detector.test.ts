import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectDeepRelativeImports } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'deep-relative');

describe('detectDeepRelativeImports', () => {
  it('flags imports that climb three or more parent directories, sorted', () => {
    const analysis = detectDeepRelativeImports(fixture);
    expect(analysis.relativeImporterCount).toBe(4);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations).toEqual([
      { file: 'src/a/b/c/deep.ts', specifier: '../../../util/helper' },
      { file: 'src/a/b/c/deep2.ts', specifier: '../../../util/helper' },
    ]);
  });

  it('does not flag one- or two-level relative imports', () => {
    const analysis = detectDeepRelativeImports(fixture);
    expect(analysis.violations.some((v) => v.file === 'src/a/near.ts')).toBe(false);
    expect(analysis.violations.some((v) => v.file === 'src/a/b/mid.ts')).toBe(false);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectDeepRelativeImports(relative).offenderCount).toBe(2);
  });
});
