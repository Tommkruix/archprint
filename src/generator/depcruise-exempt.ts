const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The regex prefix for paths under the app, as dependency-cruiser reports them from where archprint ran. */
export const appPathPrefix = (appPath: string): string => {
  const normalized = appPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized === '' || normalized === '.' ? '' : `${escapeRegExp(normalized)}/`;
};

/** A regex matching exactly these app-relative files. */
export const exactAppFiles = (files: readonly string[], appPath: string): string =>
  `^${appPathPrefix(appPath)}(?:${files.map(escapeRegExp).join('|')})$`;

export const TEST_ROLE_REGEX =
  '(\\.(test|spec|e2e-spec|e2e)\\.(ts|tsx)$)|((^|/)(__tests__|__mocks__|e2e|cypress|playwright|test|tests)/)';

export type AllowedFor = (ruleId: string) => readonly string[];

export const noneAllowed: AllowedFor = () => [];

/** The files a rule tolerates: those it was inferred with, and those allowed with a reason. */
export const toleratedFiles = (
  violations: readonly { file: string }[],
  allowed: readonly string[],
): { file: string }[] => [...violations, ...allowed.map((file) => ({ file }))];

/** A `from` exemption for the tolerated files, or none when there are none. */
export const exemptingFrom = (
  tolerated: readonly { file: string }[],
  appPath: string,
): { pathNot?: string | string[] } =>
  tolerated.length === 0 ? {} : { pathNot: exemptDepcruiseFrom([], tolerated, appPath) };

/**
 * The base patterns, plus one regex for exactly the tolerated app files as dependency-cruiser reports them from
 * where archprint ran, never another file whose path ends the same, in this app or a sibling one.
 */
export function exemptDepcruiseFrom(
  base: string | readonly string[],
  tolerated: readonly { file: string }[],
  appPath: string,
): string | string[] {
  const files = [...new Set(tolerated.map((item) => item.file))].sort();
  const parts = [
    ...(typeof base === 'string' ? [base] : base),
    ...(files.length === 0 ? [] : [exactAppFiles(files, appPath)]),
  ];
  return parts.length === 1 ? parts[0]! : parts;
}
