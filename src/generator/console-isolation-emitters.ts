import type { ConsoleIsolationAnalysis } from '../detector/console-isolation-detector.js';
import type { EslintFamilyRule } from './eslint-family-rules.js';
import { CLI_GLOBS, literalGlob, testGlobs } from './eslint-scope.js';

export function withMinedExemptions(
  baseIgnores: readonly string[],
  violations: readonly { file: string }[],
): string[] {
  return [...baseIgnores, ...violations.map((violation) => literalGlob(violation.file))];
}

export function toEslintConsoleIsolation(
  analysis: ConsoleIsolationAnalysis,
  setupFiles: readonly string[] = [],
): EslintFamilyRule | null {
  if (analysis.libraryFileCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    name: 'console-isolation',
    message: 'Do not use console in library code.',
    ignores: withMinedExemptions([...testGlobs(setupFiles), ...CLI_GLOBS], analysis.violations),
    check: { kind: 'member', object: 'console' },
  };
}
