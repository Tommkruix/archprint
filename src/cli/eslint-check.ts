import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ESLint, Linter } from 'eslint';
import { walkRepo } from '../scanner/file-walker.js';
import { ESLINT_FILE } from './generate.js';

type EslintModule = typeof import('eslint');

const LINTED_GLOB = '**/*.{ts,tsx}';
const LINTED_FILE = /\.tsx?$/;
const MIN_ESLINT_MAJOR = 9;
const SHOWN = 10;

/** Exit code for a check that could not run, as `archprint check` uses. */
const CANNOT_CHECK = 2;

/** A package as the app resolves it: the repo's own copy, never archprint's, which npx does not install. */
async function importFromApp<T>(name: string, appDir: string): Promise<T | null> {
  let resolved: string;
  try {
    resolved = createRequire(path.join(appDir, 'package.json')).resolve(name);
  } catch {
    return null;
  }
  return (await import(pathToFileURL(resolved).href)) as T;
}

async function typeScriptParser(appDir: string): Promise<Linter.Parser | null> {
  const bundle = await importFromApp<{ default: { parser: Linter.Parser } }>(
    'typescript-eslint',
    appDir,
  );
  if (bundle !== null) return bundle.default.parser;
  const parser = await importFromApp<{ default: Linter.Parser }>(
    '@typescript-eslint/parser',
    appDir,
  );
  return parser?.default ?? null;
}

const archprintRuleIds = (config: readonly Linter.Config[]): Set<string> =>
  new Set(config.flatMap((block) => Object.keys(block.rules ?? {})));

const ERROR = 2;

/** calculateConfigForFile gives every rule as `[severity, ...options]`, the severity a number (0 when off). */
const severityOf = (config: Linter.Config | undefined, ruleId: string): number =>
  (config?.rules?.[ruleId] as [number] | undefined)?.[0] ?? 0;

/**
 * For each archprint rule, the files where the generated config makes it an error and the repo's config does not: a
 * later block switched it off, downgraded it to a warning, or reconfigured it. Null when the repo's config turns on
 * no archprint rule anywhere, so it does not load the generated file.
 */
async function inactiveRules(
  files: readonly string[],
  ruleIds: ReadonlySet<string>,
  generated: ESLint,
  repo: ESLint,
): Promise<Map<string, string[]> | null> {
  const inactive = new Map<string, string[]>();
  let wired = false;
  for (const file of files) {
    const actual = (await repo.calculateConfigForFile(file)) as Linter.Config | undefined;
    if (actual === undefined) continue;
    const expected = (await generated.calculateConfigForFile(file)) as Linter.Config | undefined;
    for (const ruleId of [...ruleIds].sort()) {
      const actualSeverity = severityOf(actual, ruleId);
      if (actualSeverity > 0) wired = true;
      if (actualSeverity < ERROR && severityOf(expected, ruleId) === ERROR)
        inactive.set(ruleId, [...(inactive.get(ruleId) ?? []), file]);
    }
  }
  return wired ? inactive : null;
}

function reportInactive(inactive: ReadonlyMap<string, string[]>, appDir: string): void {
  if (inactive.size === 0) return;
  console.log(
    `Check: ${inactive.size} generated rule(s) are turned off, downgraded to a warning or overridden by your ESLint config for some files:`,
  );
  for (const [ruleId, files] of inactive) {
    console.log(
      `  ${ruleId}: not active for ${files.length} file(s), e.g. ${path.relative(appDir, files[0]!)}`,
    );
  }
  process.exitCode = 1;
}

function reportResults(
  results: readonly ESLint.LintResult[],
  ruleIds: ReadonlySet<string>,
  appDir: string,
): void {
  const offends = (message: Linter.LintMessage): boolean =>
    message.severity === ERROR && message.ruleId !== null && ruleIds.has(message.ruleId);
  const offenders = results.filter((result) => result.messages.some(offends));
  const count = offenders.reduce((total, r) => total + r.messages.filter(offends).length, 0);
  const unparsed = results.filter((result) => result.messages.some((m) => m.fatal));
  if (unparsed.length > 0) {
    console.log(`Check: ${unparsed.length} file(s) could not be parsed, so they were not checked:`);
    for (const result of unparsed.slice(0, SHOWN))
      console.log(`  ${path.relative(appDir, result.filePath)}`);
    process.exitCode = 1;
  }
  if (count === 0) {
    if (unparsed.length === 0)
      console.log('Check: the generated eslint rules pass clean on this repo.');
    return;
  }
  console.log(`Check: ${count} violation(s) of the generated rules:`);
  for (const result of offenders.slice(0, SHOWN)) {
    const rules = [...new Set(result.messages.filter(offends).map((m) => m.ruleId))];
    console.log(`  ${path.relative(appDir, result.filePath)}: ${rules.join(', ')}`);
  }
  process.exitCode = 1;
}

/**
 * Lints the repo with the generated rules through the repo's own ESLint and config, the setup its developers and
 * CI run, and reports any rule that config turns off. Before the rules are wired, it lints them on their own.
 */
export async function runEslintCheck(appDir: string, outDir: string): Promise<void> {
  const rulesFile = path.join(outDir, ESLINT_FILE);
  if (!existsSync(rulesFile)) {
    console.log('Check: no eslint rules were generated to check.');
    return;
  }
  const eslint = await importFromApp<EslintModule>('eslint', appDir);
  if (eslint === null || Number(eslint.ESLint.version.split('.')[0]) < MIN_ESLINT_MAJOR) {
    console.log(`Check: --check needs ESLint ${MIN_ESLINT_MAJOR} or later installed in ${appDir}.`);
    process.exitCode = CANNOT_CHECK;
    return;
  }
  const generatedConfig = (
    (await import(pathToFileURL(rulesFile).href)) as { default: Linter.Config[] }
  ).default;
  const ruleIds = archprintRuleIds(generatedConfig);
  const files = walkRepo(appDir)
    .map((file) => file.absolutePath)
    .filter((file) => LINTED_FILE.test(file));
  const generated = new eslint.ESLint({
    cwd: appDir,
    overrideConfigFile: true,
    overrideConfig: generatedConfig,
  });
  const repo = new eslint.ESLint({ cwd: appDir, ruleFilter: ({ ruleId }) => ruleIds.has(ruleId) });

  const configFile = await repo.findConfigFile();
  let inactive: Map<string, string[]> | null = null;
  if (configFile !== undefined) {
    try {
      inactive = await inactiveRules(files, ruleIds, generated, repo);
    } catch (error) {
      console.log(
        `Check: could not load your ESLint config, ${configFile} (${(error as Error).message}). Fix it, then check again.`,
      );
      process.exitCode = CANNOT_CHECK;
      return;
    }
  }
  let linter = repo;
  if (inactive === null) {
    const parser = await typeScriptParser(appDir);
    if (parser === null) {
      console.log(
        `Check: your ESLint config does not load ${ESLINT_FILE}, and no TypeScript parser (typescript-eslint or @typescript-eslint/parser) is installed in ${appDir} to check it on its own. Run 'archprint wire' to connect it.`,
      );
      process.exitCode = CANNOT_CHECK;
      return;
    }
    console.log(
      `Check: your ESLint config does not load ${ESLINT_FILE} yet, so its rules are checked on their own. Run 'archprint wire' to connect it.`,
    );
    linter = new eslint.ESLint({
      cwd: appDir,
      overrideConfigFile: true,
      overrideConfig: [{ files: [LINTED_GLOB], languageOptions: { parser } }, ...generatedConfig],
    });
  } else {
    reportInactive(inactive, appDir);
  }
  let results: ESLint.LintResult[];
  /* v8 ignore start -- defensive: a config that loads only fails here on a rule it cannot resolve */
  try {
    results = await linter.lintFiles([LINTED_GLOB]);
  } catch (error) {
    console.log(`Check: could not run eslint (${(error as Error).message}).`);
    process.exitCode = 1;
    return;
  }
  /* v8 ignore stop */
  reportResults(results, ruleIds, appDir);
}
