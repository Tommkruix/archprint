import type { ConsoleIsolationAnalysis } from '../detector/console-isolation-detector.js';
import { CLI_GLOBS, TEST_GLOBS } from './eslint-scope.js';

export interface EslintFlatConfigBlock {
  files: string[];
  ignores: string[];
  rules: Record<string, unknown>;
}

export function withMinedExemptions(
  baseIgnores: readonly string[],
  violations: readonly { file: string }[],
): string[] {
  return [...baseIgnores, ...violations.map((violation) => violation.file)];
}

export function toEslintConsoleIsolation(
  analysis: ConsoleIsolationAnalysis,
): EslintFlatConfigBlock | null {
  if (analysis.libraryFileCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    files: ['**/*.{ts,tsx}'],
    ignores: withMinedExemptions([...TEST_GLOBS, ...CLI_GLOBS], analysis.violations),
    rules: { 'no-console': 'error' },
  };
}
