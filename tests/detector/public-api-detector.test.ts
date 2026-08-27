import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectPublicApiBoundaries } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'public-api');
const group = (analysis: ReturnType<typeof detectPublicApiBoundaries>, dir: string) =>
  analysis.groups.find((g) => g.dir === dir);

describe('detectPublicApiBoundaries', () => {
  it('detects the barrel groups, sorted', () => {
    const analysis = detectPublicApiBoundaries(fixture);
    expect(analysis.groups.map((g) => g.dir)).toEqual(['features/auth', 'features/auth/tokens']);
  });

  it('counts external consumers and deep-import violations, sorted by file', () => {
    const auth = group(detectPublicApiBoundaries(fixture), 'features/auth')!;
    expect(auth.internalCount).toBe(2);
    expect(auth.consumerCount).toBe(4);
    expect(auth.deepImporterCount).toBe(2);
    expect(auth.violations).toEqual([
      { file: 'app/bad.ts', target: 'features/auth/login.ts' },
      { file: 'app/bad2.ts', target: 'features/auth/session.ts' },
    ]);
  });

  it('attributes an import to the nearest enclosing barrel, not an outer one', () => {
    const analysis = detectPublicApiBoundaries(fixture);
    const tokens = group(analysis, 'features/auth/tokens')!;
    expect(tokens.internalCount).toBe(1);
    expect(tokens.consumerCount).toBe(1);
    expect(tokens.deepImporterCount).toBe(0);
    expect(group(analysis, 'features/auth')!.consumerCount).toBe(4);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(group(detectPublicApiBoundaries(relative), 'features/auth')!.deepImporterCount).toBe(2);
  });

  it('reports no groups when there is no barrel', () => {
    const analysis = detectPublicApiBoundaries(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.groups).toEqual([]);
  });
});
