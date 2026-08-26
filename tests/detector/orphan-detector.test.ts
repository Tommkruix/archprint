import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectOrphans } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Fixture: page.tsx (framework entry) imports lib/widget.ts (so widget is used); lib/orphan.ts is imported by
// nobody and is not an entry; app.config.ts has zero in-degree but is a config entry; widget.test.ts is a test
// (excluded). Expected orphan: lib/orphan.ts only.
const fixture = path.join(here, '..', 'fixtures', 'orphans');

describe('detectOrphans', () => {
  it('reports a file that nothing imports and is not a framework entry', () => {
    const analysis = detectOrphans(fixture);
    expect(analysis.orphans).toEqual(['lib/orphan.ts']);
  });

  it('does not flag framework entries (page) or config files with zero in-degree', () => {
    const analysis = detectOrphans(fixture);
    expect(analysis.orphans).not.toContain('page.tsx');
    expect(analysis.orphans).not.toContain('app.config.ts');
  });

  it('excludes test files from the analysis entirely', () => {
    const analysis = detectOrphans(fixture);
    expect(analysis.orphans).not.toContain('lib/widget.test.ts');
    // widget.test.ts is not counted as a source file at all.
    expect(analysis.fileCount).toBe(4);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    const analysis = detectOrphans(relative);
    expect(analysis.orphans).toEqual(['lib/orphan.ts']);
  });

  it('fast and deep modes agree', () => {
    const fast = detectOrphans(fixture, { resolve: false }).orphans;
    const deep = detectOrphans(fixture, { resolve: true }).orphans;
    expect(deep).toEqual(fast);
  });
});
