import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeImports, walkRepo } from '../../src/scanner/file-walker.js';

const walkerFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'walker',
);

describe('walkRepo', () => {
  it('lists source files with roles and POSIX-relative paths', () => {
    const files = walkRepo(walkerFixture);
    const byPath = new Map(files.map((f) => [f.relativePath, f]));

    expect(byPath.get('user.service.ts')?.role).toBe('SERVICE');
    expect(byPath.has('leaf.ts')).toBe(true);
    expect(byPath.has('index.ts')).toBe(true);
    for (const file of files) {
      expect(path.isAbsolute(file.absolutePath)).toBe(true);
    }
  });
});

describe('analyzeImports', () => {
  it('resolves an aliased import through a barrel to its leaf module', () => {
    const imports = analyzeImports(walkerFixture, path.join(walkerFixture, 'user.service.ts'));

    expect(imports).toHaveLength(1);
    const imported = imports.at(0);
    expect(imported?.specifier).toBe('@/index');
    expect(imported?.edgeKind).toBe('alias');
    expect(imported?.throughBarrel).toBe(true);
    expect(imported?.valueLeafPaths.some((p) => p.endsWith('/leaf.ts'))).toBe(true);
    expect(imported?.valueLeafPaths.some((p) => p.endsWith('/index.ts'))).toBe(false);
  });

  it('resolves default and dynamic imports across relative, external, missing, and barrel targets', () => {
    const dir = path.join(walkerFixture, '..', 'dyn-variants');
    const imports = analyzeImports(dir, path.join(dir, 'entry.ts'));
    const bySpecifier = new Map(imports.map((imp) => [imp.specifier, imp]));

    expect(bySpecifier.get('./leaf')?.valueLeafPaths.some((p) => p.endsWith('/leaf.ts'))).toBe(
      true,
    );
    expect(
      imports.filter((imp) => imp.specifier === './leaf' && imp.valueLeafPaths.length > 0).length,
    ).toBeGreaterThan(0);
    expect(bySpecifier.get('node:path')?.valueLeafPaths).toEqual([]);
    expect(bySpecifier.get('@/missing')?.valueLeafPaths).toEqual([]);
    expect(bySpecifier.get('@/barrel')?.valueLeafPaths.some((p) => p.endsWith('/impl.ts'))).toBe(
      true,
    );
  });
});
