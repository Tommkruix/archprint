import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectRoleLayering, type RoleBoundary } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'role-layering');
const boundary = (analysis: { boundaries: RoleBoundary[] }, from: string, to: string) =>
  analysis.boundaries.find((b) => b.from === from && b.to === to);

describe('detectRoleLayering', () => {
  it('infers the clean downward direction and counts upward violations, sorted', () => {
    const analysis = detectRoleLayering(fixture);
    const serviceToController = boundary(analysis, 'SERVICE', 'CONTROLLER');
    expect(serviceToController).toBeDefined();
    expect(serviceToController!.violatingFileCount).toBe(0);
    expect(serviceToController!.reverseFlow).toBe(3);

    const repoToService = boundary(analysis, 'REPOSITORY', 'SERVICE');
    expect(repoToService).toBeDefined();
    expect(repoToService!.violatingFileCount).toBe(2);
    expect(repoToService!.violations.map((v) => v.file)).toEqual([
      'src/audit.repository.ts',
      'src/report.repository.ts',
    ]);
  });

  it('does not invent a boundary between roles that never interact', () => {
    const analysis = detectRoleLayering(fixture);
    expect(boundary(analysis, 'CONTROLLER', 'REPOSITORY')).toBeUndefined();
    expect(boundary(analysis, 'REPOSITORY', 'CONTROLLER')).toBeUndefined();
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(boundary(detectRoleLayering(relative), 'SERVICE', 'CONTROLLER')).toBeDefined();
  });

  it('reports no boundaries when there are no layer roles', () => {
    expect(detectRoleLayering(path.join(here, '..', 'fixtures', 'layers')).boundaries).toEqual([]);
  });
});
