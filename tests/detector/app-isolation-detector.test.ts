import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectAppIsolation } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/web and apps/admin: admin/dash imports web/util and admin/panel imports web/page (two cross-app
// violations). web stays clean.
const fixture = path.join(here, '..', 'fixtures', 'app-isolation');

describe('detectAppIsolation', () => {
  it('detects the apps container and counts cross-app imports', () => {
    const analysis = detectAppIsolation(fixture);
    expect(analysis.groups).toHaveLength(1);
    const group = analysis.groups[0]!;
    expect(group.container).toBe('apps');
    expect(group.appCount).toBe(2);
    expect(group.appFileCount).toBe(4);
    expect(group.crossImporterCount).toBe(2);
    expect(group.violations).toEqual([
      { file: 'apps/admin/dash.ts', target: 'apps/web/util.ts' },
      { file: 'apps/admin/panel.ts', target: 'apps/web/page.ts' },
    ]);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectAppIsolation(relative).groups[0]!.crossImporterCount).toBe(2);
  });

  it('reports no groups when there is no apps container', () => {
    const analysis = detectAppIsolation(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.groups).toEqual([]);
  });
});
