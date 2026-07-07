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
});
