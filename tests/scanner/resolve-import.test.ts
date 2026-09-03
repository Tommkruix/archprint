import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveFirstPartyImport } from '../../src/scanner/resolve-import.js';

describe('resolveFirstPartyImport', () => {
  let dir: string;
  let from: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-resolve-'));
    from = path.join(dir, 'entry.ts');
    writeFileSync(from, '');
    writeFileSync(path.join(dir, 'foo.ts'), '');
    writeFileSync(path.join(dir, 'widget.tsx'), '');
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'index.ts'), '');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves an ESM .js specifier to its .ts source', () => {
    expect(resolveFirstPartyImport('./foo.js', from, [])).toBe(path.join(dir, 'foo.ts'));
  });

  it('resolves a .jsx specifier to its .tsx source', () => {
    expect(resolveFirstPartyImport('./widget.jsx', from, [])).toBe(path.join(dir, 'widget.tsx'));
  });

  it('resolves an extensionless specifier and a directory index', () => {
    expect(resolveFirstPartyImport('./foo', from, [])).toBe(path.join(dir, 'foo.ts'));
    expect(resolveFirstPartyImport('./sub', from, [])).toBe(path.join(dir, 'sub', 'index.ts'));
  });

  it('resolves through an alias, including the .js rewrite', () => {
    const aliases = [{ prefix: '@', dir }];
    expect(resolveFirstPartyImport('@/foo.js', from, aliases)).toBe(path.join(dir, 'foo.ts'));
  });

  it('returns null for a bare package or a missing file', () => {
    expect(resolveFirstPartyImport('react', from, [])).toBeNull();
    expect(resolveFirstPartyImport('./missing.js', from, [])).toBeNull();
  });
});
