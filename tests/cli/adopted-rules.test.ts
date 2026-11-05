import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidRulesError,
  parseConfigRules,
  readAdoptedRules,
  ruleDefinitionKey,
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

describe('reading the adopted rules', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-rules-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writeConfig = (content: unknown): void =>
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify(content));
  const writeLegacy = (content: unknown): void =>
    writeFileSync(
      path.join(dir, 'rules.json'),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  const legacy = (rules: unknown[]) => ({ format: 1, archprintVersion: '0.11.0', rules });

  it('reads the rules section of config.json', () => {
    writeConfig({ archprintVersion: '9.9.9', rules: [rule] });
    expect(readAdoptedRules(dir)).toEqual([rule]);
  });

  it('reads a legacy rules.json when config.json has no rules section', () => {
    writeConfig({ archprintVersion: '0.11.0' });
    writeLegacy(legacy([rule]));
    expect(readAdoptedRules(dir)).toEqual([rule]);
  });

  it('prefers config.json over a leftover rules.json, even when it adopts nothing', () => {
    writeConfig({ archprintVersion: '9.9.9', rules: [] });
    writeLegacy(legacy([rule]));
    expect(readAdoptedRules(dir)).toEqual([]);
  });

  it('returns null when neither holds rules', () => {
    expect(readAdoptedRules(dir)).toBeNull();
    writeConfig({ archprintVersion: '9.9.9' });
    expect(readAdoptedRules(dir)).toBeNull();
  });

  it('reads the rules section of config.json text, or null without one', () => {
    expect(parseConfigRules(JSON.stringify({ rules: [rule] }), 'c')).toEqual([rule]);
    expect(parseConfigRules(JSON.stringify({ archprintVersion: '9.9.9' }), 'c')).toBeNull();
    expect(parseConfigRules('{', 'c')).toBeNull();
  });

  const invalidRules: [string, unknown][] = [
    ['a rules section that is not a list', 7],
    ['a rule that is not an object', [7]],
    ['an unknown family', [{ ...rule, family: 'role-layering' }]],
    ['a layer rule with no layers', [{ ...rule, family: 'layer', from: 'lib' }]],
    ['no resolution mode', [{ ...rule, mode: 'slow' }]],
    ['no markers', [{ ...rule, forbidden: null }]],
    ['an oversized pattern', [{ ...rule, forbidden: [{ source: 'a'.repeat(201), flags: '' }] }]],
    ['global or sticky flags', [{ ...rule, forbidden: [{ source: 'a', flags: 'g' }] }]],
    ['an invalid pattern', [{ ...rule, forbidden: [{ source: '(', flags: '' }] }]],
    ['a public-API rule with no directory', [{ ...rule, family: 'public-api', dir: 3 }]],
  ];

  it.each(invalidRules)('rejects %s in config.json', (_label, rules) => {
    writeConfig({ archprintVersion: '9.9.9', rules });
    expect(() => readAdoptedRules(dir)).toThrow(InvalidRulesError);
  });

  it.each(invalidRules)('rejects %s in a legacy rules.json', (_label, rules) => {
    writeLegacy({ format: 1, rules });
    expect(() => readAdoptedRules(dir)).toThrow(InvalidRulesError);
  });

  it('rejects a legacy rules.json that is not JSON or has another format', () => {
    writeLegacy('{');
    expect(() => readAdoptedRules(dir)).toThrow(/not valid JSON/);
    writeLegacy({ format: 0, rules: [] });
    expect(() => readAdoptedRules(dir)).toThrow(/different archprint version/);
  });
});

describe('declared rules in config.json', () => {
  const declaredRule = {
    id: 'doc-no-unstable-cache',
    family: 'declared',
    statement: 'Do not use Next.js unstable_cache().',
    mode: 'fast',
    evidence: { conforming: 3, total: 3, floor: 0.43 },
    exceptions: [],
    root: '..',
    source: { file: 'AGENTS.md', line: 4 },
    template: 'forbid-import',
    files: ['src/**'],
    except: [],
    targets: [],
    packages: [{ name: 'next/cache', imports: ['unstable_cache'] }],
  };
  const parse = (rules: unknown[]): AdoptedRule[] =>
    parseConfigRules(JSON.stringify({ rules }), '.archprint/config.json')!;

  it('reads each template back as written', () => {
    const usage = {
      ...declaredRule,
      id: 'doc-no-fetch',
      template: 'forbid-usage',
      usage: ['fetch'],
      targets: undefined,
      packages: undefined,
    };
    const freeze = { ...declaredRule, id: 'doc-freeze', template: 'forbid-file' };
    expect(parse([declaredRule, usage, freeze])).toEqual([
      declaredRule,
      JSON.parse(JSON.stringify(usage)),
      freeze,
    ]);
  });

  it.each([
    ['no root', { root: undefined }],
    ['a source without a line', { source: { file: 'AGENTS.md' } }],
    ['globs that are not text', { files: [1] }],
    ['an unknown template', { template: 'forbid-call' }],
    ['a package without a name', { packages: [{ imports: ['x'] }] }],
    ['package imports that are not text', { packages: [{ name: 'x', imports: 'y' }] }],
    ['a usage rule without usage', { template: 'forbid-usage', usage: 'fetch' }],
  ])('refuses a declared rule with %s', (_, change) => {
    expect(() => parse([JSON.parse(JSON.stringify({ ...declaredRule, ...change }))])).toThrow(
      'rule doc-no-unstable-cache is not a complete declared rule',
    );
  });

  it('keys a declared rule on its root and definition, so a changed glob is a changed rule', () => {
    const [rule] = parse([declaredRule]);
    const [widened] = parse([{ ...declaredRule, files: ['**'] }]);
    const [moved] = parse([{ ...declaredRule, root: '../..' }]);
    const [remeasured] = parse([
      { ...declaredRule, evidence: { conforming: 2, total: 3, floor: 0.2 } },
    ]);
    expect(ruleDefinitionKey(widened!)).not.toBe(ruleDefinitionKey(rule!));
    expect(ruleDefinitionKey(moved!)).not.toBe(ruleDefinitionKey(rule!));
    expect(ruleDefinitionKey(remeasured!)).toBe(ruleDefinitionKey(rule!));
  });
});
