import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidRulesError,
  readAdoptedRules,
  writeAdoptedRules,
  type AdoptedRule,
} from '../../src/cli/adopted-rules.js';

const rule: AdoptedRule = {
  id: 'AP-001',
  family: 'forbidden-imports',
  statement: 's',
  mode: 'deep',
  roles: ['ROUTE_HANDLER'],
  forbidden: [{ source: 'drizzle-orm', flags: '' }],
  evidence: { conforming: 40, total: 40, floor: 0.91 },
};

describe('rules.json', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-rules-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writeRaw = (content: unknown): void =>
    writeFileSync(path.join(dir, 'rules.json'), JSON.stringify(content));
  const withRule = (overrides: Record<string, unknown>): unknown => ({
    format: 1,
    archprintVersion: '9.9.9',
    rules: [{ ...rule, ...overrides }],
  });

  it('writes rules sorted by id, even when there are none, and reads them back', () => {
    const consoleRule: AdoptedRule = {
      ...rule,
      id: 'console-isolation',
      family: 'console-isolation',
    } as AdoptedRule;
    writeAdoptedRules(dir, [consoleRule, rule], '9.9.9');
    expect(readAdoptedRules(dir)!.rules.map((entry) => entry.id)).toEqual([
      'AP-001',
      'console-isolation',
    ]);
    writeAdoptedRules(dir, [], '9.9.9');
    expect(readAdoptedRules(dir)!.rules).toEqual([]);
  });

  it('returns null when there is no rules file', () => {
    expect(readAdoptedRules(dir)).toBeNull();
  });

  it.each([
    ['not JSON', '{'],
    ['another format', { format: 0, rules: [] }],
    ['a rule that is not an object', { format: 1, rules: [7] }],
    ['an unknown family', withRule({ family: 'layer' })],
    ['no resolution mode', withRule({ mode: 'slow' })],
    ['no markers', withRule({ forbidden: null })],
    ['an oversized pattern', withRule({ forbidden: [{ source: 'a'.repeat(201), flags: '' }] })],
    ['global or sticky flags', withRule({ forbidden: [{ source: 'a', flags: 'g' }] })],
    ['an invalid pattern', withRule({ forbidden: [{ source: '(', flags: '' }] })],
    ['a public-API rule with no directory', withRule({ family: 'public-api', dir: 3 })],
  ])('rejects %s', (_label, content) => {
    if (typeof content === 'string') writeFileSync(path.join(dir, 'rules.json'), content);
    else writeRaw(content);
    expect(() => readAdoptedRules(dir)).toThrow(InvalidRulesError);
  });
});
