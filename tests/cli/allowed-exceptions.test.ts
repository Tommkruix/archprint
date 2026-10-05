import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  allowedFilesByRule,
  parseAllowed,
  readAllowed,
  writeAllowed,
} from '../../src/cli/allowed-exceptions.js';

const json = (entries: unknown[], format: unknown = 1): string =>
  JSON.stringify({ format, entries });
const entry = (overrides: Record<string, unknown> = {}) => ({
  rule: 'AP-001',
  file: 'app/api/legacy/route.ts',
  reason: 'Health check reads the database directly by design.',
  ...overrides,
});

describe('parseAllowed', () => {
  it('reads valid entries and trims the reason', () => {
    expect(parseAllowed(json([entry({ reason: '  kept  ' })]), 'allow.json')).toEqual([
      { rule: 'AP-001', file: 'app/api/legacy/route.ts', reason: 'kept' },
    ]);
  });

  it('refuses an entry without a reason, so no exception counts unexplained', () => {
    expect(() => parseAllowed(json([entry({ reason: ' ' })]), 'allow.json')).toThrow(
      /needs a reason/,
    );
    expect(() => parseAllowed(json([entry({ reason: undefined })]), 'allow.json')).toThrow(
      /needs a reason/,
    );
  });

  it('refuses a path that is not a plain relative path inside the app', () => {
    for (const file of [
      '../outside.ts',
      '/abs.ts',
      'app\\route.ts',
      'a/./b.ts',
      '',
      'a//b.ts',
      'src/**',
      'a?.ts',
      'src/[ab].ts',
    ]) {
      expect(() => parseAllowed(json([entry({ file })]), 'allow.json')).toThrow(
        /relative to the app/,
      );
    }
  });

  it('refuses a missing rule, a duplicate entry, the wrong format and broken JSON', () => {
    expect(() => parseAllowed(json([entry({ rule: '' })]), 'a')).toThrow(/rule id/);
    expect(() => parseAllowed(json([entry(), entry()]), 'a')).toThrow(/twice/);
    expect(() => parseAllowed(json([entry()], 2), 'a')).toThrow(/different archprint version/);
    expect(() => parseAllowed('{', 'a')).toThrow(/not valid JSON/);
    expect(() => parseAllowed(json([entry({ reason: 'x'.repeat(501) })]), 'a')).toThrow(/over 500/);
  });
});

describe('reading and writing allow.json', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-allow-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads nothing when there is no file, and writes entries sorted by rule then file', () => {
    expect(readAllowed(dir)).toEqual([]);
    writeAllowed(dir, [
      entry({ rule: 'AP-002', file: 'b.ts' }),
      entry({ file: 'z.ts' }),
      entry({ file: 'a.ts' }),
    ]);
    const written = JSON.parse(readFileSync(path.join(dir, 'allow.json'), 'utf8'));
    expect(
      written.entries.map((e: { rule: string; file: string }) => `${e.rule} ${e.file}`),
    ).toEqual(['AP-001 a.ts', 'AP-001 z.ts', 'AP-002 b.ts']);
    expect(readAllowed(dir)).toHaveLength(3);
  });

  it('surfaces a broken file instead of silently ignoring it', () => {
    writeFileSync(path.join(dir, 'allow.json'), json([entry({ reason: '' })]));
    expect(() => readAllowed(dir)).toThrow(/needs a reason/);
  });

  it('groups allowed files by rule', () => {
    const grouped = allowedFilesByRule([
      entry({ file: 'a.ts' }),
      entry({ file: 'b.ts' }),
      entry({ rule: 'x', file: 'c.ts' }),
    ]);
    expect(grouped.get('AP-001')).toEqual(['a.ts', 'b.ts']);
    expect(grouped.get('x')).toEqual(['c.ts']);
  });
});
