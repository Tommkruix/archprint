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
): { pathNot?: string | string[] } =>
  tolerated.length === 0 ? {} : { pathNot: exemptDepcruiseFrom([], tolerated) };

export function exemptDepcruiseFrom(
  base: string | readonly string[],
  violations: readonly { file: string }[],
): string | string[] {
  const bases = typeof base === 'string' ? [base] : [...base];
  const parts = [
    ...bases,
    ...violations.map((violation) => `(^|/)${escapeRegExp(violation.file)}$`),
  ];
  return parts.length === 1 ? parts[0]! : parts;
}
