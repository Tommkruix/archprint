import { describe, expect, it } from 'vitest';
import {
  packageEntry,
  resolveImportTarget,
  type WorkspacePackage,
} from '../../src/detector/import-target.js';

const known =
  (...files: string[]) =>
  (candidate: string): boolean =>
    files.includes(candidate);

describe('packageEntry', () => {
  it('reads exports["."] before types and main, mapping .js to its .ts source', () => {
    const isFile = known('packages/db/src/index.ts', 'packages/db/index.ts');
    expect(
      packageEntry(
        { exports: { '.': { import: './src/index.js' } }, main: './index.ts' },
        'packages/db',
        isFile,
      ),
    ).toBe('packages/db/src/index.ts');
  });

  it('reads a conditions object at the top of exports as the root export', () => {
    expect(
      packageEntry({ exports: { default: './src/main.ts' } }, 'pkg', known('pkg/src/main.ts')),
    ).toBe('pkg/src/main.ts');
  });

  it('skips subpath-only exports and falls back to main, then an index file', () => {
    expect(
      packageEntry(
        { exports: { './button': './button.ts' }, main: './index.ts' },
        'packages/ui',
        known('packages/ui/index.ts'),
      ),
    ).toBe('packages/ui/index.ts');
    expect(packageEntry({}, 'packages/lib', known('packages/lib/index.tsx'))).toBe(
      'packages/lib/index.tsx',
    );
  });

  it('is null when no field points at a source file, as for a package that ships dist/ only', () => {
    expect(packageEntry({ main: 'dist/index.js' }, 'packages/db', known())).toBeNull();
    expect(packageEntry(undefined, 'packages/db', known())).toBeNull();
  });
});

describe('resolveImportTarget', () => {
  const aliases = [{ prefix: '@', dir: 'apps/web/src' }];
  const packages: WorkspacePackage[] = [
    { name: '@acme/db', dir: 'packages/db', entry: 'packages/db/src/index.ts' },
    { name: '@acme/web', dir: 'apps/web', entry: null },
  ];
  const isFile = known(
    'apps/web/src/lib/db.ts',
    'packages/mcds/button/index.tsx',
    'apps/web/src/app.ts',
  );
  const target = (from: string, specifier: string): string | null =>
    resolveImportTarget(from, specifier, aliases, packages, isFile);

  it('resolves relative paths across apps and alias paths to the source file', () => {
    expect(target('packages/mcds/a.ts', '../../apps/web/src/app')).toBe('apps/web/src/app.ts');
    expect(target('apps/web/src/a.ts', '@/lib/db')).toBe('apps/web/src/lib/db.ts');
    expect(target('packages/mcds/a.ts', './button')).toBe('packages/mcds/button/index.tsx');
  });

  it('resolves a workspace package root to its entry, or its directory when the entry is unknown', () => {
    expect(target('apps/web/src/a.ts', '@acme/db')).toBe('packages/db/src/index.ts');
    expect(target('packages/mcds/a.ts', '@acme/web')).toBe('apps/web/');
  });

  it('resolves a workspace subpath under the package directory, kept as written when no file matches', () => {
    expect(target('packages/mcds/a.ts', '@acme/web/src/app')).toBe('apps/web/src/app.ts');
    expect(target('packages/mcds/a.ts', '@acme/db/client')).toBe('packages/db/client');
  });

  it('is null for a package outside the repo and a path that climbs above the root', () => {
    expect(target('apps/web/src/a.ts', 'react')).toBeNull();
    expect(target('a.ts', '../outside')).toBeNull();
  });
});
