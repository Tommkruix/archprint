import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeImports } from '../../src/scanner/file-walker.js';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'barrel-db',
);
const endsWith = (paths: string[], suffix: string) => paths.some((p) => p.endsWith(suffix));

describe('symbol-level, type-aware import attribution', () => {
  it('does NOT attribute the db leaf when only an unrelated value is imported through the barrel', () => {
    const imports = analyzeImports(fixture, path.join(fixture, 'good-route.ts'));
    const allValueLeaves = imports.flatMap((i) => i.valueLeafPaths);

    expect(endsWith(allValueLeaves, '/lib/format.ts')).toBe(true);
    expect(endsWith(allValueLeaves, '/lib/prisma.ts')).toBe(false);
  });

  it('classifies a type-only import as type, not a runtime dependency', () => {
    const imports = analyzeImports(fixture, path.join(fixture, 'good-route.ts'));
    const typeImport = imports.find((i) => i.typeLeafPaths.length > 0);

    expect(endsWith(typeImport?.typeLeafPaths ?? [], '/lib/prisma.ts')).toBe(true);
    expect(typeImport?.valueLeafPaths ?? []).toEqual([]);
  });

  it('DOES attribute the db leaf when the db value itself is imported', () => {
    const imports = analyzeImports(fixture, path.join(fixture, 'bad-route.ts'));
    const allValueLeaves = imports.flatMap((i) => i.valueLeafPaths);

    expect(endsWith(allValueLeaves, '/lib/prisma.ts')).toBe(true);
  });

  it('labels the aliased barrel import as an alias edge', () => {
    const imports = analyzeImports(fixture, path.join(fixture, 'bad-route.ts'));
    expect(imports.at(0)?.edgeKind).toBe('alias');
    expect(imports.at(0)?.throughBarrel).toBe(true);
  });
});
