import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  allowedFilesByRule,
  parseLegacyAllowed,
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

describe('parseLegacyAllowed', () => {
  it('reads valid entries and trims the reason', () => {
    expect(parseLegacyAllowed(json([entry({ reason: '  kept  ' })]), 'allow.json')).toEqual([
      { rule: 'AP-001', file: 'app/api/legacy/route.ts', reason: 'kept' },
    ]);
  });

  it('refuses an entry without a reason, so no exception counts unexplained', () => {
    expect(() => parseLegacyAllowed(json([entry({ reason: ' ' })]), 'allow.json')).toThrow(
      /needs a reason/,
    );
    expect(() => parseLegacyAllowed(json([entry({ reason: undefined })]), 'allow.json')).toThrow(
      /needs a reason/,
    );
  });

  it('refuses a path that is not a plain relative path inside the app', () => {
    for (const file of ['../outside.ts', '/abs.ts', 'app\\route.ts', 'a/./b.ts', '', 'a//b.ts']) {
      expect(() => parseLegacyAllowed(json([entry({ file })]), 'allow.json')).toThrow(
        /relative to the app/,
      );
    }
  });

  it('refuses a wildcard, since an entry names one file', () => {
    for (const file of ['src/**', 'a?.ts', 'app/*/route.ts']) {
      expect(() => parseLegacyAllowed(json([entry({ file })]), 'allow.json')).toThrow(
        /one file, not a pattern/,
      );
    }
  });

  it('accepts the folder names web frameworks use for routes', () => {
    for (const file of [
      'app/api/orders/[id]/route.ts',
      'app/[[...slug]]/page.tsx',
      'app/(shop)/@modal/(.)cart/page.tsx',
      'src/{legacy}/x.ts',
    ]) {
      expect(parseLegacyAllowed(json([entry({ file })]), 'allow.json')[0]!.file).toBe(file);
    }
  });

  it('refuses a missing rule, a duplicate entry, the wrong format and broken JSON', () => {
    expect(() => parseLegacyAllowed(json([entry({ rule: '' })]), 'a')).toThrow(/rule id/);
    expect(() => parseLegacyAllowed(json([entry(), entry()]), 'a')).toThrow(/twice/);
    expect(() => parseLegacyAllowed(json([entry()], 2), 'a')).toThrow(
      /different archprint version/,
    );
    expect(() => parseLegacyAllowed('{', 'a')).toThrow(/not valid JSON/);
    expect(() => parseLegacyAllowed(json([entry({ reason: 'x'.repeat(501) })]), 'a')).toThrow(
      /over 500/,
    );
  });
});

describe('reading and writing the allowed exceptions', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-allow-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const configFile = (): string => path.join(dir, 'config.json');
  const legacyFile = (): string => path.join(dir, 'allow.json');
  const writeConfig = (content: Record<string, unknown>): void =>
    writeFileSync(configFile(), JSON.stringify({ archprintVersion: '9.9.9', ...content }));
  const readConfigJson = () => JSON.parse(readFileSync(configFile(), 'utf8'));

  it('reads nothing when there is no config or legacy file', () => {
    expect(readAllowed(dir)).toEqual([]);
  });

  it('writes entries into config.json sorted by rule then file, keeping its other sections', () => {
    writeConfig({ rules: ['kept'] });
    writeAllowed(dir, [
      entry({ rule: 'AP-002', file: 'b.ts' }),
      entry({ file: 'z.ts' }),
      entry({ file: 'a.ts' }),
    ]);
    const written = readConfigJson();
    expect(
      written.allowed.map((e: { rule: string; file: string }) => `${e.rule} ${e.file}`),
    ).toEqual(['AP-001 a.ts', 'AP-001 z.ts', 'AP-002 b.ts']);
    expect(written.rules).toEqual(['kept']);
    expect(readAllowed(dir)).toHaveLength(3);
  });

  it('reads a legacy allow.json until config.json has an allowed section, then deletes it on write', () => {
    writeConfig({});
    writeFileSync(legacyFile(), json([entry()]));
    expect(readAllowed(dir)).toEqual([entry()]);
    writeAllowed(dir, readAllowed(dir));
    expect(existsSync(legacyFile())).toBe(false);
    expect(readConfigJson().allowed).toEqual([entry()]);
  });

  it('prefers config.json over a leftover allow.json, even when it allows nothing', () => {
    writeConfig({ allowed: [] });
    writeFileSync(legacyFile(), json([entry()]));
    expect(readAllowed(dir)).toEqual([]);
  });

  it('keeps keys it does not know when it records the entries', () => {
    writeConfig({ team: { owner: 'platform' } });
    writeAllowed(dir, [entry()]);
    expect(readConfigJson().team).toEqual({ owner: 'platform' });
  });

  it('refuses to write an entry it would refuse to read', () => {
    writeConfig({});
    expect(() => writeAllowed(dir, [entry({ file: 'app/*/route.ts' })])).toThrow(/not a pattern/);
    expect(readConfigJson().allowed).toBeUndefined();
  });

  it('refuses to write without a config.json', () => {
    expect(() => writeAllowed(dir, [entry()])).toThrow(/config\.json is missing/);
  });

  it('surfaces a broken section or file instead of silently ignoring it', () => {
    writeConfig({ allowed: [entry({ reason: '' })] });
    expect(() => readAllowed(dir)).toThrow(/needs a reason/);
    writeConfig({ allowed: [entry(), entry()] });
    expect(() => readAllowed(dir)).toThrow(/twice/);
    writeConfig({ allowed: {} });
    expect(() => readAllowed(dir)).toThrow(/different archprint version/);
    writeConfig({});
    writeFileSync(legacyFile(), json([entry({ reason: '' })]));
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
