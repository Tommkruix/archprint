/** A rule as a user names it: by id, label or ESLint name (`archprint/<id>`), in any case and spacing. */
export const ruleKey = (ref: string): string =>
  ref
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/^archprint\//, '');

export interface NamedRule {
  id: string;
  label?: string;
}

export function findRule<T extends NamedRule>(ref: string, rules: readonly T[]): T | undefined {
  const key = ruleKey(ref);
  return rules.find(
    (rule) => ruleKey(rule.id) === key || (rule.label !== undefined && ruleKey(rule.label) === key),
  );
}

/** Every id and distinct label, for an error that names what a reference could have matched. */
export const ruleNames = (rules: readonly NamedRule[]): string[] => [
  ...new Set(rules.flatMap((rule) => [rule.id, ...(rule.label === undefined ? [] : [rule.label])])),
];
