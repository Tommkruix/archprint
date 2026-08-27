import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackageApi } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'workspace-package');

describe('detectWorkspacePackageApi', () => {
  it('flags deep imports into a sibling workspace package, sorted', () => {
    const analysis = detectWorkspacePackageApi(fixture);
    expect(analysis.packages).toContain('@scope/pkg-b');
    expect(analysis.consumerCount).toBe(3);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations.map((v) => v.file)).toEqual([
      'packages/pkg-a/src/bad.ts',
      'packages/pkg-a/src/bad2.ts',
    ]);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectWorkspacePackageApi(relative).offenderCount).toBe(2);
  });

  it('reports no consumers when there is no workspace', () => {
    const analysis = detectWorkspacePackageApi(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.packages).toEqual([]);
    expect(analysis.consumerCount).toBe(0);
  });
});
