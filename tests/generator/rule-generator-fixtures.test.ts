import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Rule } from 'eslint';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { afterAll, describe, expect, it } from 'vitest';
import { emitRuleArtifacts, evaluateGate, generateRuleArtifacts } from '../../src/index.js';
import type { DetectedPattern, PatternConfig } from '../../src/index.js';
import { scanRepo } from '../../src/cli/scan.js';

const hooks = RuleTester as unknown as {
  afterAll: typeof afterAll;
  describe: typeof describe;
  it: typeof it;
  itOnly: typeof it.only;
};
hooks.afterAll = afterAll;
hooks.describe = describe;
hooks.it = it;
hooks.itOnly = it.only;

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = mkdtempSync(path.join(tmpdir(), 'archprint-rule-fixtures-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const scan = scanRepo(path.join(here, '..', 'fixtures', 'cli-auto'));
const autoPatterns = scan.patterns.filter((pattern) => pattern.result.gate.status === 'AUTO');
const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
});
const FIXTURE_FILENAME = 'app/api/example/route.ts';

describe('generated fixtures against the generated rule', () => {
  it('covers both forbidden-import rules the fixture repo adopts', () => {
    expect(autoPatterns.map((pattern) => pattern.config.id).sort()).toEqual(['AP-001', 'AP-002']);
  });
});

for (const { config, result } of autoPatterns) {
  const ruleDir = emitRuleArtifacts(config, result, outDir, 'test provenance');
  const rule = (
    (await import(pathToFileURL(path.join(ruleDir, `${config.name}.ts`)).href)) as {
      default: Rule.RuleModule;
    }
  ).default;
  const fixture = (name: string): string =>
    readFileSync(path.join(ruleDir, 'fixtures', name), 'utf8');

  ruleTester.run(`${config.id} ${config.name}`, rule, {
    valid: [{ name: 'passing fixture', filename: FIXTURE_FILENAME, code: fixture('passing.ts') }],
    invalid: [
      {
        name: 'failing fixture',
        filename: FIXTURE_FILENAME,
        code: fixture('failing.ts'),
        errors: [{ messageId: 'forbidden' }],
      },
    ],
  });
}

describe('rule artifacts describe their own rule', () => {
  const ap001 = autoPatterns.find((pattern) => pattern.config.id === 'AP-001')!;

  it('states the database rule, not the UI rule, in its message, card and fixture', () => {
    const { files } = generateRuleArtifacts(ap001.config, ap001.result);
    expect(files.rule).toContain(
      'AP-001: A request handler must not import the database client directly (imported \\"{{specifier}}\\").',
    );
    expect(`${files.rule}${files.card}${files.failingFixture}`).not.toMatch(/components|UI layer/);
  });
});

describe('choosing the import the failing fixture uses', () => {
  const config: PatternConfig = {
    id: 'AP-009',
    name: 'no-x-in-route',
    description: 'A request handler must not import x.',
    roles: ['ROUTE_HANDLER'],
    forbidden: [/(^|\/)x(\/|$)/],
    examples: ['@/x/example'],
  };
  const gate = evaluateGate({ roleFileCount: 40, violatingFileCount: 1, roleConfidence: 0.95 });
  const result = (specifiers: string[]): DetectedPattern => ({
    id: config.id,
    name: config.name,
    description: config.description,
    roles: config.roles,
    stats: {
      roleFileCount: 40,
      conformingFileCount: 40 - specifiers.length,
      violatingFileCount: specifiers.length,
      ratio: gate.observedConformance,
      roleConfidence: 0.95,
    },
    gate,
    violations: specifiers.map((specifier) => ({
      file: 'app/api/legacy/route.ts',
      specifier,
      leaf: 'x/thing.ts',
    })),
    infraCaution: false,
    infraExceptions: [],
  });
  const failingImport = (artifacts: { files: { failingFixture: string } }): string =>
    /import \* as forbidden from '([^']+)'/.exec(artifacts.files.failingFixture)![1]!;

  it('prefers a real exception from the repo over an inferred example', () => {
    expect(failingImport(generateRuleArtifacts(config, result(['@/x/legacy'])))).toBe('@/x/legacy');
  });

  it('skips an exception whose import text the rule cannot see, such as a barrel', () => {
    expect(failingImport(generateRuleArtifacts(config, result(['@/lib/kit'])))).toBe('@/x/example');
  });

  it('refuses to write a failing fixture when no known import matches the rule', () => {
    expect(() => generateRuleArtifacts({ ...config, examples: [] }, result([]))).toThrow(
      /AP-009: no known import matches its forbidden patterns/,
    );
  });

  it('refuses a passing fixture its own rule would flag', () => {
    expect(() =>
      generateRuleArtifacts(
        { ...config, forbidden: [/next\/server/], examples: ['next/server'] },
        result([]),
      ),
    ).toThrow(/AP-009: its forbidden patterns match "next\/server"/);
  });
});
