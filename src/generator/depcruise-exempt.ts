const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const TEST_ROLE_REGEX =
  '(\\.(test|spec|e2e-spec|e2e)\\.(ts|tsx)$)|((^|/)(__tests__|__mocks__|e2e|cypress|playwright|test|tests)/)';

export function exemptDepcruiseFrom(
  base: string | readonly string[],
  violations: readonly { file: string }[],
): string | string[] {
  const bases = typeof base === 'string' ? [base] : [...base];
  const parts = [...bases, ...violations.map((violation) => `${escapeRegExp(violation.file)}$`)];
  return parts.length === 1 ? parts[0]! : parts;
}
