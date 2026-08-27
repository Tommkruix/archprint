import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeImports, detectCycles } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'dynamic-import');

describe('dynamic import() support', () => {
  it('captures a dynamic import as a value edge, resolved in deep mode', () => {
    const imports = analyzeImports(fixture, path.join(fixture, 'b.ts'));
    const dynamic = imports.find((imp) => imp.specifier === '@/a');
    expect(dynamic).toBeDefined();
    expect(dynamic!.hasValueBinding).toBe(true);
    expect(dynamic!.valueLeafPaths.some((leaf) => leaf.endsWith('/a.ts'))).toBe(true);
  });

  it('finds a cycle that closes through a dynamic import (fast mode)', () => {
    const analysis = detectCycles(fixture, { resolve: false });
    expect(analysis.cycles).toHaveLength(1);
    expect(analysis.cycles[0]!.files).toEqual(['a.ts', 'b.ts']);
  });
});
