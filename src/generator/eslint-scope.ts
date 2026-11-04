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

const atAppRoot = (appPath: string): boolean => appPath === '.' || appPath === '';

/** An app file's path from the repository root, where archprint wire puts the reference. */
export const repoPath = (file: string, appPath: string): string =>
  atAppRoot(appPath) ? file : `${appPath}/${file}`;

/**
 * A glob that matches exactly `file`, whose path may hold characters globs read as syntax: Next.js `[id]`,
 * `[...slug]`, `(group)` and `@slot` folders. Brackets escape them on every platform; braces and a leading `!`
 * have no bracket form, so they take a backslash, which ESLint 9 on Windows reads as a separator.
 */
export const literalGlob = (file: string): string =>
  file
    .replace(/[*?[\]()+@]/g, '[$&]')
    .replace(/[{}]/g, '\\$&')
    .replace(/^!/, '\\!');

/**
 * The globs that exempt one app file for a config at the repository root and for a config inside the app.
 * A file glob (from literalGlob) is prefixed with the escaped app path; a ** glob passes through.
 */
export const exemptionGlobs = (glob: string, appPath: string): string[] =>
  glob.includes('**') || atAppRoot(appPath) ? [glob] : [`${literalGlob(appPath)}/${glob}`, glob];

export const CLI_GLOBS: readonly string[] = dirAndFile(['cli', 'scripts', 'bin', 'tools']);

export const CONFIG_GLOBS: readonly string[] = [
  ...dirAndFile(['config', 'env', 'environment']),
  '**/*.config.{ts,tsx}',
];
