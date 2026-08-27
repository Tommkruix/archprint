import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectPhantomDependencies } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'phantom-deps');

describe('detectPhantomDependencies', () => {
  it('flags imports of packages not declared in package.json, sorted', () => {
    const analysis = detectPhantomDependencies(fixture);
    expect(analysis.externalImporterCount).toBe(4);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations).toEqual([
      { file: 'src/bad.ts', specifier: 'lodash', package: 'lodash' },
      { file: 'src/bad2.ts', specifier: 'zod', package: 'zod' },
    ]);
  });

  it('treats a declared dependency (react) as valid, and ignores builtins/first-party', () => {
    const analysis = detectPhantomDependencies(fixture);
    expect(analysis.violations.some((v) => v.package === 'react')).toBe(false);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectPhantomDependencies(relative).offenderCount).toBe(2);
  });
});
