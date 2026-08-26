import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectFeatureSliceIsolation } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/features holds three slices: auth (self-contained), billing (invoice cross-imports auth), and profile
// (view cross-imports billing). Two cross-slice violations; same-slice imports (auth/session -> auth/login)
// are not violations.
const fixture = path.join(here, '..', 'fixtures', 'feature-slice');

describe('detectFeatureSliceIsolation', () => {
  it('detects each container with two or more slices, sorted, and skips single-slice containers', () => {
    const analysis = detectFeatureSliceIsolation(fixture);
    // src/features (3 slices) and src/modules (2 slices); src/domains has one slice and is skipped.
    expect(analysis.groups.map((g) => g.container)).toEqual(['src/features', 'src/modules']);
    const features = analysis.groups[0]!;
    expect(features.sliceCount).toBe(3);
    expect(features.sliceFileCount).toBe(5);
  });

  it('counts only cross-slice imports as violations, not same-slice imports, sorted by file', () => {
    const group = detectFeatureSliceIsolation(fixture).groups[0]!;
    expect(group.crossImporterCount).toBe(2);
    expect(group.violations).toEqual([
      { file: 'src/features/billing/invoice.ts', target: 'src/features/auth/login.ts' },
      { file: 'src/features/profile/view.ts', target: 'src/features/billing/charge.ts' },
    ]);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectFeatureSliceIsolation(relative).groups[0]!.crossImporterCount).toBe(2);
  });

  it('reports no groups when there is no feature container', () => {
    const analysis = detectFeatureSliceIsolation(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.groups).toEqual([]);
  });
});
