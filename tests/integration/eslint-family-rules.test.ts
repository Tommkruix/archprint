import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wireEslintContent } from '../../src/cli/wiring.js';
import { toEslintConsoleIsolation } from '../../src/generator/console-isolation-emitters.js';
import { toEslintDeepRelative } from '../../src/generator/deep-relative-emitters.js';
import { toEslintEnvAccess } from '../../src/generator/env-access-emitters.js';
import { renderEslintPreset } from '../../src/generator/eslint-preset-emitter.js';
import { toEslintTestIsolation } from '../../src/generator/test-isolation-emitters.js';
import { evaluateGate } from '../../src/detector/confidence-gate.js';

const clean = (population: number) =>
  evaluateGate({ roleFileCount: population, violatingFileCount: 0, roleConfidence: 1 });

const families = [
  toEslintTestIsolation({
    appDir: '.',
    productionFileCount: 60,
    testFileCount: 5,
    offenderCount: 0,
    gate: clean(60),
    violations: [],
  }),
  toEslintDeepRelative({
    appDir: '.',
    relativeImporterCount: 60,
    offenderCount: 0,
    gate: clean(60),
    violations: [],
  }),
  toEslintConsoleIsolation({
    appDir: '.',
    libraryFileCount: 60,
    offenderCount: 0,
    gate: clean(60),
    violations: [],
  }),
  toEslintEnvAccess({
    appDir: '.',
    subjectFileCount: 60,
    offenderCount: 0,
    gate: clean(60),
    violations: [],
  }),
].map((family) => family!);

const REPO_CONFIG = `import tseslint from '${import.meta.resolve('typescript-eslint')}';

export default [
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
  {
    files: ['packages/ui/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: 'lodash', message: 'own rule' }] }] },
  },
  { files: ['src/legacy/**'], rules: { 'no-console': 'off' } },
];
`;

describe('archprint family rules in a repo that configures the same core rules (real ESLint)', () => {
  let tmp: string;
  let eslint: ESLint;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'archprint-family-rules-'));
    mkdirSync(path.join(tmp, '.archprint'));
    writeFileSync(path.join(tmp, '.archprint', 'eslint.mjs'), renderEslintPreset([], families));
    const wired = wireEslintContent(REPO_CONFIG, './.archprint/eslint.mjs');
    expect(wired.changed).toBe(true);
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), wired.content!);
    eslint = new ESLint({ cwd: tmp });
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const ruleIds = async (code: string, file: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath: path.join(tmp, file) });
    return result!.messages.map((message) => message.ruleId ?? message.message).sort();
  };

  it("keeps test isolation where the repo sets its own no-restricted-imports, and the repo's rule too", async () => {
    expect(await ruleIds("import { a } from './button.test';\n", 'packages/ui/x.ts')).toEqual([
      'archprint/test-isolation',
    ]);
    expect(await ruleIds("import _ from 'lodash';\n", 'packages/ui/x.ts')).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('keeps console isolation where the repo turns no-console off', async () => {
    expect(await ruleIds("console.log('x');\n", 'src/legacy/x.ts')).toEqual([
      'archprint/console-isolation',
    ]);
  });

  it('reports a dynamic import of a test file, not a type-only one, as the scan counts them', async () => {
    expect(await ruleIds("export const a = import('./a.test');\n", 'src/x.ts')).toEqual([
      'archprint/test-isolation',
    ]);
    expect(await ruleIds("import type { A } from './a.test';\n", 'src/x.ts')).toEqual([]);
    expect(await ruleIds("import { type A } from './a.test';\n", 'src/x.ts')).toEqual([]);
  });

  it('reports a type-only deep relative import, as the import-style scan counts it', async () => {
    expect(await ruleIds("import type { A } from '../../../a';\n", 'src/x.ts')).toEqual([
      'archprint/import-style',
    ]);
  });

  it('reports process.env reads and nothing else on process', async () => {
    expect(await ruleIds('export const k = process.env.KEY;\n', 'src/x.ts')).toEqual([
      'archprint/env-access',
    ]);
    expect(await ruleIds('export const c = process.cwd();\n', 'src/x.ts')).toEqual([]);
  });

  it('exempts the test files the scan left out', async () => {
    expect(
      await ruleIds("console.log(process.env.KEY);\nimport '../../../a';\n", 'src/x.test.ts'),
    ).toEqual([]);
  });
});
