import type { EslintFlatConfigBlock } from './console-isolation-emitters.js';

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
