import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectOrphans } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
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
