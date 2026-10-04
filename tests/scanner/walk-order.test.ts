import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    readdirSync: ((...args: Parameters<typeof fs.readdirSync>) =>
      [...(fs.readdirSync(...args) as unknown[])].reverse()) as typeof fs.readdirSync,
  };
});

const { listSourceFiles } = await import('../../src/scanner/file-walker.js');

describe('listSourceFiles order', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists files in name order whatever order the filesystem returns them in', () => {
    root = mkdtempSync(path.join(tmpdir(), 'archprint-walk-order-'));
    for (const relative of ['b/two.ts', 'b/one.ts', 'a/z.ts', 'a/y.ts', 'c.ts', 'a.ts']) {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      writeFileSync(path.join(root, relative), 'export {};\n');
    }
    expect(listSourceFiles(root).map((file) => path.relative(root, file))).toEqual([
      'a/y.ts',
      'a/z.ts',
      'a.ts',
      'b/one.ts',
      'b/two.ts',
      'c.ts',
    ]);
  });
});
