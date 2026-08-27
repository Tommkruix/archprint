import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectTestIsolation } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// src has four production files (math, good, bad, bad2) and one test (math.test). bad.ts and bad2.ts import
// the test file: two violations. good.ts and math.ts stay clean.
const fixture = path.join(here, '..', 'fixtures', 'test-isolation');

describe('detectTestIsolation', () => {
  it('counts production files that import a test file, sorted by file', () => {
    const analysis = detectTestIsolation(fixture);
    expect(analysis.productionFileCount).toBe(4);
    expect(analysis.testFileCount).toBe(1);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations).toEqual([
      { file: 'src/bad.ts', target: 'src/math.test.ts' },
      { file: 'src/bad2.ts', target: 'src/math.test.ts' },
    ]);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectTestIsolation(relative).offenderCount).toBe(2);
  });

  it('reports no test files for an app without tests', () => {
    const analysis = detectTestIsolation(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.testFileCount).toBe(0);
    expect(analysis.offenderCount).toBe(0);
  });
});
