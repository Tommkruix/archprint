import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectDependencyInternals } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'dependency-internals');

describe('detectDependencyInternals', () => {
  it('flags reaches into a package’s /src/ and /internal/, but not its published dist/ output', () => {
    const analysis = detectDependencyInternals(fixture);
    expect(analysis.externalImporterCount).toBe(5);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations).toEqual([
      { file: 'src/bad.ts', specifier: 'lodash/internal/chunk' },
      { file: 'src/bad2.ts', specifier: '@scope/pkg/src/thing' },
    ]);
    // a documented dist/esm public entry point must NOT be flagged as an internals reach
    expect(analysis.violations.some((v) => v.specifier.includes('/dist/'))).toBe(false);
  });

  it('does not count node builtins or first-party imports as external', () => {
    const analysis = detectDependencyInternals(fixture);
    expect(analysis.externalImporterCount).toBe(5);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectDependencyInternals(relative).offenderCount).toBe(2);
  });
});
