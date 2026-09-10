const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// dependency-cruiser `from.pathNot` accepts a string or an array of regexes. Append the tolerated
// violation files the confidence gate accepted so the emitted rule stays green on the scanned repo,
// the same guarantee the ESLint emitters give via `ignores`.
export function exemptDepcruiseFrom(
  basePathNot: string,
  violations: readonly { file: string }[],
): string | string[] {
  if (violations.length === 0) return basePathNot;
  return [basePathNot, ...violations.map((violation) => `${escapeRegExp(violation.file)}$`)];
}
