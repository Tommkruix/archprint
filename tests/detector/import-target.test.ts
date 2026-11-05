import { describe, expect, it } from 'vitest';
import { packageEntry, packageSubpaths, sourceFileFor } from '../../src/detector/import-target.js';
import { resolveImportTarget, type WorkspacePackage } from '../../src/detector/layer-paths.js';

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

  it('tries a declaration file last, so a built checkout resolves as an unbuilt one does', () => {
    const exportsField = { '.': { types: './dist/index.d.ts', import: './src/index.ts' } };
    expect(
      packageEntry(
        { exports: exportsField, types: './dist/index.d.ts' },
        'pkg',
        known('pkg/dist/index.d.ts', 'pkg/src/index.ts'),
      ),
    ).toBe('pkg/src/index.ts');
    expect(packageEntry({ types: './index.d.ts' }, 'types', known('types/index.d.ts'))).toBe(
      'types/index.d.ts',
    );
  });

  it('is null when no field points at a source file, as for a package that ships dist/ only', () => {
    expect(packageEntry({ main: 'dist/index.js' }, 'packages/db', known())).toBeNull();
    expect(packageEntry(undefined, 'packages/db', known())).toBeNull();
  });
});

describe('packageSubpaths', () => {
  it('orders exact keys before patterns, the longest part before * first, then the longest key', () => {
    const exportsField = {
      '.': './src/index.ts',
      './*': './src/*.ts',
      './utils/*.js': './src/utils/*.ts',
      './utils/*': './src/utils/*/index.ts',
      './button': './src/button.tsx',
    };
    expect(packageSubpaths({ exports: exportsField }, 'packages/ui').map(({ key }) => key)).toEqual(
      ['./button', './utils/*.js', './utils/*', './*'],
    );
  });

  it('keeps every relative target from the root, in the order written with declaration files last, and none for a null target', () => {
    const exportsField = {
      './v3/zod': {
        types: './dist/v3/zod.d.ts',
        '@acme/source': './src/v3/zod.ts',
        default: ['./dist/v3/zod.js', 'other-package'],
      },
      './internal/*': null,
    };
    expect(packageSubpaths({ exports: exportsField }, 'packages/core')).toEqual([
      {
        key: './v3/zod',
        targets: [
          'packages/core/src/v3/zod.ts',
          'packages/core/dist/v3/zod.js',
          'packages/core/dist/v3/zod.d.ts',
        ],
      },
      { key: './internal/*', targets: [] },
    ]);
  });

  it('skips folder keys and keys with more than one *, and reads no subpaths from a root-only export', () => {
    const exportsField = { './features/': './src/features/', './a/*/b/*': './src/*.ts' };
    expect(packageSubpaths({ exports: exportsField }, 'pkg')).toEqual([]);
    expect(packageSubpaths({ exports: './index.ts' }, 'pkg')).toEqual([]);
    expect(packageSubpaths({ exports: { import: './index.js' } }, 'pkg')).toEqual([]);
    expect(packageSubpaths(undefined, 'pkg')).toEqual([]);
  });
});

describe('resolveImportTarget through subpath exports', () => {
  const kit = (exportsField: unknown): WorkspacePackage => ({
    name: '@acme/kit',
    dir: 'packages/kit',
    entry: null,
    subpaths: packageSubpaths({ exports: exportsField }, 'packages/kit'),
  });
  const resolve = (pkg: WorkspacePackage, specifier: string, ...files: string[]): string | null =>
    resolveImportTarget('apps/web/a.ts', specifier, [], [pkg], sourceFileFor(known(...files)));

  it('takes the first target that names a source file, whatever its condition', () => {
    const pkg = kit({
      './v3/zod': {
        types: './dist/v3/zod.d.ts',
        source: './src/v3/zod.ts',
        default: './dist/v3/zod.js',
      },
    });
    expect(resolve(pkg, '@acme/kit/v3/zod', 'packages/kit/src/v3/zod.ts')).toBe(
      'packages/kit/src/v3/zod.ts',
    );
  });

  it('resolves the same in a built checkout, trying a declaration file in dist last', () => {
    const pkg = kit({
      './v3/zod': { types: './dist/v3/zod.d.ts', source: './src/v3/zod.ts' },
    });
    const built = ['packages/kit/dist/v3/zod.d.ts', 'packages/kit/src/v3/zod.ts'];
    expect(resolve(pkg, '@acme/kit/v3/zod', ...built)).toBe('packages/kit/src/v3/zod.ts');
  });

  it('maps a .js target to its .ts source', () => {
    const pkg = kit({ './client': './src/client.js' });
    expect(resolve(pkg, '@acme/kit/client', 'packages/kit/src/client.ts')).toBe(
      'packages/kit/src/client.ts',
    );
  });

  it('prefers an exact key to a pattern, and the more specific of two patterns', () => {
    const pkg = kit({
      './*': './src/*.ts',
      './utils/*': './lib/utils/*.ts',
      './button': './lib/button.tsx',
    });
    const files = [
      'packages/kit/src/button.ts',
      'packages/kit/lib/button.tsx',
      'packages/kit/src/utils/date.ts',
      'packages/kit/lib/utils/date.ts',
    ];
    expect(resolve(pkg, '@acme/kit/button', ...files)).toBe('packages/kit/lib/button.tsx');
    expect(resolve(pkg, '@acme/kit/utils/date', ...files)).toBe('packages/kit/lib/utils/date.ts');
    expect(resolve(pkg, '@acme/kit/theme', 'packages/kit/src/theme.ts')).toBe(
      'packages/kit/src/theme.ts',
    );
  });

  it('replaces every * in the target, across slashes', () => {
    const pkg = kit({ './icons/*': './src/icons/*/*.tsx' });
    expect(
      resolve(
        pkg,
        '@acme/kit/icons/brand/star',
        'packages/kit/src/icons/brand/star/brand/star.tsx',
      ),
    ).toBe('packages/kit/src/icons/brand/star/brand/star.tsx');
  });

  it('matches a pattern with a suffix only when the * stands for at least one character', () => {
    const pkg = kit({ './locales/*.json': './src/locales/*.ts' });
    expect(resolve(pkg, '@acme/kit/locales/en.json', 'packages/kit/src/locales/en.ts')).toBe(
      'packages/kit/src/locales/en.ts',
    );
    expect(resolve(pkg, '@acme/kit/locales/.json', 'packages/kit/src/locales/.ts')).toBe(
      'packages/kit/locales/.json',
    );
  });

  it('falls back to the path under the package directory when the matched key has no source target', () => {
    const pkg = kit({ './*': './src/*.ts', './internal/*': null, './dist-only': './dist/x.js' });
    expect(resolve(pkg, '@acme/kit/internal/secret', 'packages/kit/src/internal/secret.ts')).toBe(
      'packages/kit/internal/secret',
    );
    expect(resolve(pkg, '@acme/kit/dist-only', 'packages/kit/dist-only.ts')).toBe(
      'packages/kit/dist-only.ts',
    );
  });
});

describe('resolveImportTarget', () => {
  const aliases = [{ prefix: '@', dir: 'apps/web/src' }];
  const packages: WorkspacePackage[] = [
    { name: '@acme/db', dir: 'packages/db', entry: 'packages/db/src/index.ts', subpaths: [] },
    { name: '@acme/web', dir: 'apps/web', entry: null, subpaths: [] },
  ];
  const isFile = known(
    'apps/web/src/lib/db.ts',
    'packages/mcds/button/index.tsx',
    'apps/web/src/app.ts',
  );
  const target = (from: string, specifier: string): string | null =>
    resolveImportTarget(from, specifier, aliases, packages, sourceFileFor(isFile));

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
