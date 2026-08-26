import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { discoverAppDirs } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.resolve(here, '..', 'fixtures', name);

describe('discoverAppDirs', () => {
  it('returns the app-dir itself when the root is a single app', () => {
    const root = fixture('ui-infer');
    expect(discoverAppDirs(root, 1)).toEqual([root]);
  });

  it('discovers the tsconfig-bearing package in a monorepo, not the package without one', () => {
    const root = fixture('monorepo');
    const dirs = discoverAppDirs(root, 1).map((dir) => path.relative(root, dir));
    expect(dirs).toContain(path.join('packages', 'web'));
    expect(dirs).not.toContain(path.join('packages', 'db'));
  });

  it('discovers an apps/ layout', () => {
    const root = fixture('monorepo-db');
    const dirs = discoverAppDirs(root, 1).map((dir) => path.relative(root, dir));
    expect(dirs).toContain(path.join('apps', 'web'));
  });

  it('falls back to any tsconfig dir with source when none clears the default size threshold', () => {
    // The fixture holds far fewer than the default 25 files, so the size filter is empty and the fallback
    // (every tsconfig dir owning at least one file) selects the app anyway.
    const root = fixture('dynamic-import');
    expect(discoverAppDirs(root)).toEqual([root]);
  });
});
