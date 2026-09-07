import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverAppDirs } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.resolve(here, '..', 'fixtures', name);

describe('discoverAppDirs', () => {
  const temps: string[] = [];
  const scratch = (files: Record<string, string>): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'archprint-appdirs-'));
    temps.push(dir);
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('recognizes tsconfig.base.json as a TS project (not only tsconfig.json)', () => {
    const root = scratch({ 'tsconfig.base.json': '{}', 'index.ts': 'export const a = 1;' });
    expect(discoverAppDirs(root, 1)).toEqual([root]);
  });

  it('scans a repo that declares a tsconfig but has no walked source, never "no app dir"', () => {
    const root = scratch({ 'tsconfig.json': '{}', 'README.md': '# icons' });
    expect(discoverAppDirs(root)).toEqual([root]);
  });

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
    const root = fixture('dynamic-import');
    expect(discoverAppDirs(root)).toEqual([root]);
  });
});
