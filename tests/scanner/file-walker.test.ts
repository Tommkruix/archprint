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
    // Symbol-level: the value binding `leaf` resolves to leaf.ts, not the index barrel.
    expect(imported?.valueLeafPaths.some((p) => p.endsWith('/leaf.ts'))).toBe(true);
    expect(imported?.valueLeafPaths.some((p) => p.endsWith('/index.ts'))).toBe(false);
  });

  // dyn-variants/entry.ts: a resolved default import plus four dynamic imports (relative, external,
  // aliased-but-missing, and through a barrel), covering every dynamic-resolution branch.
  it('resolves default and dynamic imports across relative, external, missing, and barrel targets', () => {
    const dir = path.join(walkerFixture, '..', 'dyn-variants');
    const imports = analyzeImports(dir, path.join(dir, 'entry.ts'));
    const bySpecifier = new Map(imports.map((imp) => [imp.specifier, imp]));

    // Default import resolves to the leaf that defines it.
    expect(bySpecifier.get('./leaf')?.valueLeafPaths.some((p) => p.endsWith('/leaf.ts'))).toBe(
      true,
    );
    // A relative dynamic import resolves to a first-party file.
    expect(
      imports.filter((imp) => imp.specifier === './leaf' && imp.valueLeafPaths.length > 0).length,
    ).toBeGreaterThan(0);
    // An external dynamic import resolves to no first-party leaf.
    expect(bySpecifier.get('node:path')?.valueLeafPaths).toEqual([]);
    // An aliased dynamic import with no target file resolves to nothing.
    expect(bySpecifier.get('@/missing')?.valueLeafPaths).toEqual([]);
    // A dynamic import through a barrel resolves to the re-exported leaf.
    expect(bySpecifier.get('@/barrel')?.valueLeafPaths.some((p) => p.endsWith('/impl.ts'))).toBe(
      true,
    );
  });
});
