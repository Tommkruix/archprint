import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeImports, isWorkspacePackagePath, walkRepo } from '../../src/scanner/file-walker.js';

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

describe('isWorkspacePackagePath', () => {
  const pkgs = ['@acme/db', '@acme/ui'];

  it('matches the package directory itself and files under it', () => {
    expect(isWorkspacePackagePath('/r/node_modules/@acme/db', pkgs)).toBe(true);
    expect(isWorkspacePackagePath('/r/node_modules/@acme/db/src/index.ts', pkgs)).toBe(true);
    expect(isWorkspacePackagePath('/r/node_modules/@acme/db\\win\\x.ts', pkgs)).toBe(true);
  });

  it('does not match a different package that shares a prefix or an external', () => {
    expect(isWorkspacePackagePath('/r/node_modules/@acme/db-extra/index.ts', pkgs)).toBe(false);
    expect(isWorkspacePackagePath('/r/node_modules/react/index.js', pkgs)).toBe(false);
    expect(isWorkspacePackagePath('/r/src/db.ts', pkgs)).toBe(false);
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

  it('resolves a baseUrl file import to its first-party leaf while skipping externals', () => {
    const dir = path.join(walkerFixture, '..', 'baseurl-file');
    const imports = analyzeImports(dir, path.join(dir, 'src', 'entry.ts'));
    const bySpecifier = new Map(imports.map((imp) => [imp.specifier, imp]));

    expect(bySpecifier.get('utils')?.valueLeafPaths.some((p) => p.endsWith('/utils.ts'))).toBe(
      true,
    );
    expect(bySpecifier.get('./rel')?.valueLeafPaths.some((p) => p.endsWith('/rel.ts'))).toBe(true);
    expect(bySpecifier.get('react')?.valueLeafPaths).toEqual([]);
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
