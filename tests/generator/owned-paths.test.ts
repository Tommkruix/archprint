import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ownedPath, removeOwnedFile, writeOwnedFile } from '../../src/generator/owned-paths.js';

describe('ownedPath', () => {
  let root: string;
  let outside: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'archprint-owned-'));
    outside = mkdtempSync(path.join(tmpdir(), 'archprint-elsewhere-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('accepts a path strictly inside the folder, relative or absolute', () => {
    expect(ownedPath(root, 'eslint.mjs')).toBe(path.join(root, 'eslint.mjs'));
    expect(ownedPath(root, path.join(root, 'rule', 'card.md'))).toBe(
      path.join(root, 'rule', 'card.md'),
    );
  });

  it('refuses the folder itself, its parents, siblings and other absolute paths', () => {
    for (const target of ['', '.', '..', '../sibling', 'a/../../x', outside, '/']) {
      expect(ownedPath(root, target)).toBeNull();
    }
  });

  it('refuses a path that a symlink inside the folder redirects elsewhere', () => {
    symlinkSync(outside, path.join(root, 'link'), 'dir');
    expect(ownedPath(root, 'link/victim.txt')).toBeNull();
    mkdirSync(path.join(root, 'real'));
    expect(ownedPath(root, 'real/file.txt')).toBe(path.join(root, 'real', 'file.txt'));
  });

  it('replaces a symlinked file with a real one instead of writing through it', () => {
    writeFileSync(path.join(outside, 'victim.txt'), 'mine\n');
    symlinkSync(path.join(outside, 'victim.txt'), path.join(root, 'config.json'));
    writeOwnedFile(root, path.join(root, 'config.json'), '{}\n');
    expect(readFileSync(path.join(outside, 'victim.txt'), 'utf8')).toBe('mine\n');
    expect(lstatSync(path.join(root, 'config.json')).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(root, 'config.json'), 'utf8')).toBe('{}\n');
  });

  it('refuses to write under a subfolder that is a symlink pointing elsewhere', () => {
    symlinkSync(outside, path.join(root, 'rule'), 'dir');
    expect(() =>
      writeOwnedFile(root, path.join(root, 'rule', 'fixtures', 'failing.ts'), 'x'),
    ).toThrow(/refuses to write/);
    expect(() => readFileSync(path.join(outside, 'fixtures', 'failing.ts'))).toThrow();
  });

  it('removes a regular file inside the folder and leaves a folder, a symlink or an outside file alone', () => {
    writeFileSync(path.join(root, 'rules.json'), '{}');
    expect(removeOwnedFile(root, path.join(root, 'rules.json'))).toBe(true);
    expect(existsSync(path.join(root, 'rules.json'))).toBe(false);
    expect(removeOwnedFile(root, path.join(root, 'rules.json'))).toBe(false);

    mkdirSync(path.join(root, 'allow.json'));
    expect(removeOwnedFile(root, path.join(root, 'allow.json'))).toBe(false);
    expect(lstatSync(path.join(root, 'allow.json')).isDirectory()).toBe(true);

    writeFileSync(path.join(outside, 'victim.txt'), 'mine\n');
    symlinkSync(path.join(outside, 'victim.txt'), path.join(root, 'link.json'));
    expect(removeOwnedFile(root, path.join(root, 'link.json'))).toBe(false);
    expect(removeOwnedFile(root, path.join(outside, 'victim.txt'))).toBe(false);
    expect(readFileSync(path.join(outside, 'victim.txt'), 'utf8')).toBe('mine\n');
  });
});
