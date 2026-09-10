const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function exemptDepcruiseFrom(
  basePathNot: string,
  violations: readonly { file: string }[],
): string | string[] {
  if (violations.length === 0) return basePathNot;
  return [basePathNot, ...violations.map((violation) => `${escapeRegExp(violation.file)}$`)];
}
