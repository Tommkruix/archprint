import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectDependencyInternals } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'dependency-internals');

describe('detectDependencyInternals', () => {
  it('counts external importers and flags reaches into package build directories, sorted', () => {
    const analysis = detectDependencyInternals(fixture);
    expect(analysis.externalImporterCount).toBe(4);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations).toEqual([
      { file: 'src/bad.ts', specifier: 'lodash/dist/chunk' },
      { file: 'src/bad2.ts', specifier: '@scope/pkg/src/thing' },
    ]);
  });

  it('does not count node builtins or first-party imports as external', () => {
    const analysis = detectDependencyInternals(fixture);
    expect(analysis.externalImporterCount).toBe(4);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectDependencyInternals(relative).offenderCount).toBe(2);
  });
});
