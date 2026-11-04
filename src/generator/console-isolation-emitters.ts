import type { ConsoleIsolationAnalysis } from '../detector/console-isolation-detector.js';
import type { EslintFamilyRule } from './eslint-family-rules.js';
import { CLI_GLOBS, literalGlob, TEST_GLOBS } from './eslint-scope.js';

export function withMinedExemptions(
  baseIgnores: readonly string[],
  violations: readonly { file: string }[],
): string[] {
  return [...baseIgnores, ...violations.map((violation) => literalGlob(violation.file))];
}

export function toEslintConsoleIsolation(
  analysis: ConsoleIsolationAnalysis,
): EslintFamilyRule | null {
  if (analysis.libraryFileCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    name: 'console-isolation',
    message: 'Do not use console in library code.',
    ignores: withMinedExemptions([...TEST_GLOBS, ...CLI_GLOBS], analysis.violations),
    check: { kind: 'member', object: 'console' },
  };
}
