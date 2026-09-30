import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIgnoreFilter } from '../../src/scanner/ignore-filter.js';

const write = (dir: string, rel: string, contents: string): void => {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
};

describe('createIgnoreFilter', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-ignore-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('always ignores the default noise directories', () => {
    const isIgnored = createIgnoreFilter(dir);
    expect(isIgnored('node_modules', true)).toBe(true);
    expect(isIgnored('dist', true)).toBe(true);
    expect(isIgnored('', true)).toBe(false);
    expect(isIgnored('src/app.ts', false)).toBe(false);
  });

  it('honors patterns from the .gitignore at the root', () => {
    writeFileSync(path.join(dir, '.gitignore'), 'ab/\nsecret.ts\n');
    const isIgnored = createIgnoreFilter(dir);
    expect(isIgnored('ab', true)).toBe(true);
    expect(isIgnored('ab/cache/repo/file.ts', false)).toBe(true);
    expect(isIgnored('secret.ts', false)).toBe(true);
    expect(isIgnored('src/app.ts', false)).toBe(false);
  });

  it('honors .git/info/exclude (repo-local excludes)', () => {
    write(dir, '.git/info/exclude', 'ab/\n');
    const isIgnored = createIgnoreFilter(dir);
    expect(isIgnored('ab', true)).toBe(true);
    expect(isIgnored('ab/cache/cal.com/packages/ui/x.ts', false)).toBe(true);
    expect(isIgnored('src/app.ts', false)).toBe(false);
  });

  it('honors a nested .gitignore scoped to its own subtree', () => {
    write(dir, 'packages/foo/.gitignore', 'generated/\n');
    const isIgnored = createIgnoreFilter(dir);
    expect(isIgnored('packages/foo/generated', true)).toBe(true);
    expect(isIgnored('packages/foo/generated/out.ts', false)).toBe(true);
    expect(isIgnored('packages/bar/generated', true)).toBe(false);
    expect(isIgnored('packages/foo/src/app.ts', false)).toBe(false);
  });
});
