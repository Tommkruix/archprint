const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Append the gate's tolerated files to `from.pathNot` so the emitted rule stays green on the repo,
// the dependency-cruiser analog of the ESLint emitters' `ignores`.
export function exemptDepcruiseFrom(
  basePathNot: string,
  violations: readonly { file: string }[],
): string | string[] {
  if (violations.length === 0) return basePathNot;
  return [basePathNot, ...violations.map((violation) => `${escapeRegExp(violation.file)}$`)];
}
