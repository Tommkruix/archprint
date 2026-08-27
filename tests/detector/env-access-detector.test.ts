import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectEnvAccess } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'env-access');

describe('detectEnvAccess', () => {
  it('flags process.env reads outside the config layer, sorted', () => {
    const analysis = detectEnvAccess(fixture);
    expect(analysis.envUserCount).toBe(4);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations.map((v) => v.file)).toEqual(['src/other.ts', 'src/service.ts']);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectEnvAccess(relative).offenderCount).toBe(2);
  });

  it('reports no env users for a codebase that never reads process.env', () => {
    const analysis = detectEnvAccess(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.envUserCount).toBe(0);
    expect(analysis.offenderCount).toBe(0);
  });
});
