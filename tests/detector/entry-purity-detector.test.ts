import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectEntryPurity } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'entry-purity');

describe('detectEntryPurity', () => {
  it('flags framework entries that other code imports, sorted', () => {
    const analysis = detectEntryPurity(fixture);
    expect(analysis.entryCount).toBe(4);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations).toEqual([
      { file: 'app/profile/page.tsx', importer: 'helper.ts' },
      { file: 'app/settings/page.tsx', importer: 'helper.ts' },
    ]);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectEntryPurity(relative).offenderCount).toBe(2);
  });

  it('reports no entries when there are none', () => {
    const analysis = detectEntryPurity(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.entryCount).toBe(0);
    expect(analysis.offenderCount).toBe(0);
  });
});
