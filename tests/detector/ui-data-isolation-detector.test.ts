import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectUiDataIsolation } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'ui-data');

describe('detectUiDataIsolation', () => {
  it('flags UI components that import the data layer directly, sorted', () => {
    const analysis = detectUiDataIsolation(fixture);
    expect(analysis.componentCount).toBe(3);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations).toEqual([
      { file: 'src/components/Widget.tsx', target: 'src/db/queries.ts' },
      { file: 'src/components/Widget2.tsx', target: 'src/db/queries.ts' },
    ]);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectUiDataIsolation(relative).offenderCount).toBe(2);
  });

  it('reports no components for a codebase without any', () => {
    const analysis = detectUiDataIsolation(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.offenderCount).toBe(0);
  });

  it('does not AUTO the rule when there is no data layer to import (vacuous)', () => {
    const analysis = detectUiDataIsolation(path.join(here, '..', 'fixtures', 'ui-data-nodata'));
    expect(analysis.componentCount).toBeGreaterThanOrEqual(35);
    expect(analysis.offenderCount).toBe(0);
    expect(analysis.gate.status).not.toBe('AUTO');
  });
});
