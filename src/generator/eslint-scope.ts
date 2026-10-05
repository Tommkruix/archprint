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

/**
 * The paths an ESLint config needs to exempt one app file: prefixed with the app for a config at the repository
 * root (where archprint wire puts the reference), and plain for a config inside the app. Patterns pass through.
 */
export const exemptionPaths = (entry: string, appPath: string): string[] =>
  entry.includes('*') || appPath === '.' || appPath === ''
    ? [entry]
    : [`${appPath}/${entry}`, entry];

export const CLI_GLOBS: readonly string[] = dirAndFile(['cli', 'scripts', 'bin', 'tools']);

export const CONFIG_GLOBS: readonly string[] = [
  ...dirAndFile(['config', 'env', 'environment']),
  '**/*.config.{ts,tsx}',
];

export type NoRestrictedImportsBlock = { ignores?: string[]; rules: Record<string, unknown> };

const restrictImports = (patterns: readonly unknown[]): Record<string, unknown> => ({
  'no-restricted-imports': ['error', { patterns }],
});

/**
 * One base block with every family's patterns, plus one block per group of excepted files carrying only the
 * patterns of the families that still apply to them. ESLint gives a file a single configuration of a rule, so
 * merging the families' ignores into one list would exempt a file from every family at once.
 */
export function mergeNoRestrictedImports(
  blocks: readonly (NoRestrictedImportsBlock | null)[],
): EslintFlatConfigBlock[] {
  const families = blocks
    .filter((block): block is NoRestrictedImportsBlock => block !== null)
    .map((block) => {
      const rule = block.rules['no-restricted-imports'] as
        [string, { patterns: unknown[] }] | undefined;
      const exempt = (block.ignores ?? []).filter((glob) => !TEST_GLOBS.includes(glob));
      return { patterns: rule?.[1].patterns ?? [], exempt: new Set(exempt) };
    })
    .filter((family) => family.patterns.length > 0);
  if (families.length === 0) return [];
  const exempt = [...new Set(families.flatMap((family) => [...family.exempt]))].sort();
  const groups = new Map<string, { files: string[]; patterns: unknown[] }>();
  for (const file of exempt) {
    const applying = families.filter((family) => !family.exempt.has(file));
    const key = applying.map((family) => families.indexOf(family)).join(',');
    const group = groups.get(key) ?? { files: [], patterns: applying.flatMap((f) => f.patterns) };
    group.files.push(file);
    groups.set(key, group);
  }
  const overrides = [...groups.values()]
    .filter((group) => group.patterns.length > 0)
    .map((group) => ({
      files: group.files,
      ignores: [...TEST_GLOBS],
      rules: restrictImports(group.patterns),
    }));
  return [
    {
      files: ['**/*.{ts,tsx}'],
      ignores: [...TEST_GLOBS, ...exempt],
      rules: restrictImports(families.flatMap((family) => family.patterns)),
    },
    ...overrides,
  ];
}
