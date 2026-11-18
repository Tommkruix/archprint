import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { cruise, type ICruiseResult, type IFlattenedRuleSet } from 'dependency-cruiser';
import { ESLint } from 'eslint';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/cli/program.js';
import { TEST_ROLE_REGEX } from '../../src/generator/depcruise-exempt.js';
import { scanRepo } from '../../src/cli/scan.js';
import { dependencyApp } from './dependency-app.js';
import { lintConfig } from './eslint-harness.js';
import { writeTree } from './layer-app.js';

const PHANTOM = 'archprint/no-phantom-dependencies';
const ENTRY = 'archprint/no-import-framework-entry';
const SETUP = [
  "import _ from 'lodash';",
  "import Page from '@/app/r0/page';",
  "import { a } from './a.test';",
  "console.log('ready');",
  'export const setup = [_, Page, a];',
  '',
].join('\n');

describe.each([{ app: '.' }, { app: 'apps/web' }])(
  'a file the vitest config names in setupFiles, app at $app (real ESLint and dependency-cruiser)',
  ({ app }) => {
    let cwd: string;
    let repo: string;
    const appFile = (file: string): string => path.join(repo, app, file);
    const generate = (emit: string, ...rules: string[]) =>
      buildProgram('9.9.9').parseAsync(
        [
          'generate',
          app,
          '--include-structural',
          '--emit',
          emit,
          ...(rules.length === 0 ? [] : ['--rules', rules.join(',')]),
        ],
        { from: 'user' },
      );

    beforeEach(() => {
      cwd = process.cwd();
      repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-test-setup-')));
      writeTree(path.join(repo, app), {
        ...dependencyApp(),
        'vitest.config.ts': "export default { test: { setupFiles: ['./src/test-setup.ts'] } };\n",
        'src/test-setup.ts': SETUP,
        'node_modules/lodash/package.json': '{"name":"lodash","main":"index.js"}',
        'node_modules/lodash/index.js': 'module.exports = {};\n',
      });
      process.chdir(repo);
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      process.chdir(cwd);
      vi.restoreAllMocks();
      rmSync(repo, { recursive: true, force: true });
    });

    it('is a test file to the scan, so its imports are no exception', () => {
      const scan = scanRepo(path.join(repo, app));
      expect(scan.testSetupFiles).toEqual(['src/test-setup.ts']);
      expect(scan.phantomDependencies.violations.map((violation) => violation.file)).toEqual([
        'src/lib/legacy-phantom.ts',
      ]);
      expect(scan.entryPurity.imports.map((entry) => entry.importer)).toEqual([
        'src/lib/legacy-entry.ts',
      ]);
    });

    it('is skipped by every generated ESLint rule, each of which reports the same code in production', async () => {
      await generate('eslint');
      const eslint = new ESLint({
        cwd: repo,
        overrideConfigFile: lintConfig(repo, './.archprint/eslint.mjs'),
      });
      const rules = async (file: string): Promise<string[]> =>
        (await eslint.lintText(SETUP, { filePath: appFile(file) }))[0]!.messages
          .map((message) => message.ruleId ?? message.message)
          .sort();
      expect(await rules('src/test-setup.ts')).toEqual([]);
      expect(await rules('src/lib/fresh.ts')).toEqual([
        'archprint/console-isolation',
        ENTRY,
        PHANTOM,
        'archprint/test-isolation',
      ]);
    });

    it('is exempt in every generated dependency-cruiser rule that exempts test files', async () => {
      await generate('all');
      const { forbidden } = JSON.parse(
        readFileSync(path.join(repo, '.archprint', 'dependency-cruiser.json'), 'utf8'),
      ) as { forbidden: { name: string; from: { pathNot?: string | string[] } }[] };
      const exemptsTests = forbidden.filter((rule) =>
        [rule.from.pathNot ?? []].flat().includes(TEST_ROLE_REGEX),
      );
      const setupPath = path.posix.join(app, 'src/test-setup.ts');
      expect(
        exemptsTests
          .filter((rule) =>
            [rule.from.pathNot!].flat().some((pattern) => new RegExp(pattern).test(setupPath)),
          )
          .map((rule) => rule.name)
          .sort(),
      ).toEqual([
        'no-dependency-internals',
        'no-import-framework-entry',
        'no-phantom-dependencies',
        'no-server-only-in-client',
      ]);
      expect(exemptsTests).toHaveLength(4);
    });

    it('is skipped by the generated dependency-cruiser rules, which report the same imports in production code', async () => {
      await generate('dependency-cruiser', 'no-phantom-dependencies');
      writeFileSync(appFile('src/lib/fresh.ts'), SETUP);
      const ruleSet = JSON.parse(
        readFileSync(path.join(repo, '.archprint', 'dependency-cruiser.json'), 'utf8'),
      ) as IFlattenedRuleSet;
      const result = await cruise([path.join(app, 'src')], {
        validate: true,
        ruleSet,
        baseDir: repo,
      });
      const fresh = path.posix.join(app, 'src/lib/fresh.ts');
      expect(
        (result.output as ICruiseResult).summary.violations
          .map((violation) => `${violation.rule.name}: ${violation.from}`)
          .sort(),
      ).toEqual([`no-phantom-dependencies: ${fresh}`]);
    });
  },
);
