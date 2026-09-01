import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectEnvAccess } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'env-access');

describe('detectEnvAccess', () => {
  it('flags non-config files that read process.env, sorted; config reads are not offenders', () => {
    const analysis = detectEnvAccess(fixture);
    // population = the two non-config files (config/env.ts and config/settings.ts are excluded)
    expect(analysis.subjectFileCount).toBe(2);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations.map((v) => v.file)).toEqual(['src/other.ts', 'src/service.ts']);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectEnvAccess(relative).offenderCount).toBe(2);
  });

  it('does not AUTO when nothing reads process.env at all (vacuous)', () => {
    const analysis = detectEnvAccess(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.offenderCount).toBe(0);
    expect(analysis.subjectFileCount).toBeGreaterThan(0);
    expect(analysis.gate.status).not.toBe('AUTO');
  });
});
