import type { ConsoleIsolationAnalysis } from '../detector/console-isolation-detector.js';

export interface EslintFlatConfigBlock {
  files: string[];
  ignores: string[];
  rules: Record<string, unknown>;
}

export function toEslintConsoleIsolation(
  analysis: ConsoleIsolationAnalysis,
): EslintFlatConfigBlock | null {
  if (analysis.libraryFileCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/cli/**', '**/scripts/**', '**/bin/**', '**/tools/**'],
    rules: { 'no-console': 'error' },
  };
}
