import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectConsoleIsolation } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'console-isolation');

describe('detectConsoleIsolation', () => {
  it('flags library files that use console, excluding CLI paths, sorted', () => {
    const analysis = detectConsoleIsolation(fixture);
    expect(analysis.libraryFileCount).toBe(4);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations.map((v) => v.file)).toEqual(['src/log.ts', 'src/log2.ts']);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectConsoleIsolation(relative).offenderCount).toBe(2);
  });

  it('reports no offenders for a codebase that avoids console', () => {
    const analysis = detectConsoleIsolation(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.libraryFileCount).toBeGreaterThan(0);
    expect(analysis.offenderCount).toBe(0);
  });
});
