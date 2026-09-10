import type { EslintFlatConfigBlock } from './console-isolation-emitters.js';

// Glob equivalents of the detector population predicates, so an emitted rule lints exactly the files
// the detector scored. Keep in sync with the regexes in src/scanner/role-classifier.ts (TEST role),
// console-isolation-detector.ts (CLI_PATH), and env-access-detector.ts (CONFIG_PATH).

const dirAndFile = (names: readonly string[]): string[] =>
  names.flatMap((name) => [`**/${name}/**`, `**/${name}.{ts,tsx}`]);

export const TEST_GLOBS: readonly string[] = [
  '**/*.{test,spec,e2e-spec,e2e}.{ts,tsx}',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/e2e/**',
  '**/cypress/**',
  '**/playwright/**',
  '**/test/**',
  '**/tests/**',
];

export const CLI_GLOBS: readonly string[] = dirAndFile(['cli', 'scripts', 'bin', 'tools']);

export const CONFIG_GLOBS: readonly string[] = [
  ...dirAndFile(['config', 'env', 'environment']),
  '**/*.config.{ts,tsx}',
];

export type NoRestrictedImportsBlock = { ignores?: string[]; rules: Record<string, unknown> };

// ESLint flat config replaces (does not merge) a rule set by multiple config objects, so the last
// `no-restricted-imports` block wins and the others are silently dropped. Merge the family patterns
// into a single block instead. Tests are excluded (every source family scores production files only).
export function mergeNoRestrictedImports(
  blocks: readonly (NoRestrictedImportsBlock | null)[],
): EslintFlatConfigBlock | null {
  const patterns: unknown[] = [];
  const ignores = new Set<string>(TEST_GLOBS);
  for (const block of blocks) {
    if (block === null) continue;
    const rule = block.rules['no-restricted-imports'] as
      [string, { patterns: unknown[] }] | undefined;
    if (rule) patterns.push(...rule[1].patterns);
    for (const glob of block.ignores ?? []) ignores.add(glob);
  }
  if (patterns.length === 0) return null;
  return {
    files: ['**/*.{ts,tsx}'],
    ignores: [...ignores],
    rules: { 'no-restricted-imports': ['error', { patterns }] },
  };
}
