import { describe, expect, it } from 'vitest';
import { packageSubpaths } from '../../src/detector/import-target.js';
import { layerRootOf, matchingSubpath, resolveImportPath } from '../../src/detector/layer-paths.js';

const aliases = [
  { prefix: '@', dir: 'src' },
  { prefix: '@api', dir: '../api/src' },
  { prefix: 'lib', dir: 'lib' },
];

describe('layerRootOf', () => {
  it('returns the layer and the folder it starts in', () => {
    expect(layerRootOf('src/lib/db/client.ts')).toEqual({ layer: 'lib', dir: 'src/lib' });
    expect(layerRootOf('src/app/(dash)/lib/h.ts')).toEqual({ layer: 'app', dir: 'src/app' });
    expect(layerRootOf('middleware.ts')).toBeNull();
  });
});

describe('resolveImportPath', () => {
  it('resolves a relative import against the importing file', () => {
    expect(resolveImportPath('src/lib/db/client.ts', '../../app/page', [])).toBe('src/app/page');
    expect(resolveImportPath('src/lib/a.ts', './b', [])).toBe('src/lib/b');
  });

  it('resolves an alias by prefix, including the bare prefix itself', () => {
    expect(resolveImportPath('src/lib/a.ts', '@/app/page', aliases)).toBe('src/app/page');
    expect(resolveImportPath('src/lib/a.ts', 'lib', aliases)).toBe('lib');
    expect(resolveImportPath('src/lib/a.ts', 'lib/x', aliases)).toBe('lib/x');
  });

  it('returns null for a package, or for a path that leaves the app', () => {
    expect(resolveImportPath('src/lib/a.ts', 'react', aliases)).toBeNull();
    expect(resolveImportPath('src/lib/a.ts', 'library', aliases)).toBeNull();
    expect(resolveImportPath('src/lib/a.ts', '../../../outside', aliases)).toBeNull();
    expect(resolveImportPath('src/lib/a.ts', '@api/routes', aliases)).toBeNull();
  });
});

describe('matchingSubpath', () => {
  const subpaths = packageSubpaths(
    {
      exports: {
        './*': './src/*.ts',
        './icons/*': './src/icons/*.tsx',
        './icons/internal/*': null,
        './button': './src/button.tsx',
      },
    },
    'pkg',
  );
  const key = (subpath: string): string | undefined => matchingSubpath(subpaths, subpath)?.key;

  it('matches an exact key before any pattern, then the most specific pattern', () => {
    expect(key('./button')).toBe('./button');
    expect(key('./icons/star')).toBe('./icons/*');
    expect(key('./theme')).toBe('./*');
  });

  it('returns a blocked key with its empty targets, so a broader pattern does not let the subpath through', () => {
    expect(matchingSubpath(subpaths, './icons/internal/raw')).toEqual({
      key: './icons/internal/*',
      targets: [],
    });
  });

  it('matches nothing when no key covers the subpath', () => {
    expect(
      matchingSubpath(packageSubpaths({ exports: { './button': './b.ts' } }, 'pkg'), './card'),
    ).toBeUndefined();
  });
});
