import type { AdoptedRule } from './adopted-rules.js';

/** One rule's files, or `importer -> entry` imports for entry purity. */
export interface RuleExceptions {
  rule: string;
  exceptions: string[];
}

type ExceptionsByRule = ReadonlyMap<string, readonly string[]>;

const compare = (
  rules: readonly AdoptedRule[],
  current: ExceptionsByRule,
  pick: (recorded: ReadonlySet<string>, now: readonly string[]) => string[],
): RuleExceptions[] =>
  rules.flatMap((rule) => {
    const now = current.get(rule.id);
    if (rule.exceptions === undefined || now === undefined) return [];
    const exceptions = pick(new Set(rule.exceptions), now);
    return exceptions.length === 0 ? [] : [{ rule: rule.id, exceptions }];
  });

/** What breaks each adopted rule now that was not an exception when the rule was written. */
export const newExceptions = (rules: readonly AdoptedRule[], current: ExceptionsByRule) =>
  compare(rules, current, (recorded, now) => now.filter((item) => !recorded.has(item)));

/** Recorded exceptions the code no longer has: the rule now applies to them. */
export const fixedExceptions = (rules: readonly AdoptedRule[], current: ExceptionsByRule) =>
  compare(rules, current, (recorded, now) => {
    const remaining = new Set(now);
    return [...recorded].filter((item) => !remaining.has(item));
  });

/** Rules an earlier version adopted without recording their exceptions, with what this run records for them. */
export const firstRecorded = (
  rules: readonly AdoptedRule[],
  current: ExceptionsByRule,
): RuleExceptions[] =>
  rules
    .filter((rule) => rule.exceptions === undefined && (current.get(rule.id)?.length ?? 0) > 0)
    .map((rule) => ({ rule: rule.id, exceptions: [...current.get(rule.id)!] }));

export const formatExceptions = (entries: readonly RuleExceptions[]): string =>
  entries.map(({ rule, exceptions }) => `  ${rule}: ${exceptions.join(', ')}`).join('\n');

export class NewViolationsError extends Error {
  constructor(readonly broken: readonly RuleExceptions[]) {
    super(
      [
        'Refusing to regenerate: these break rules you adopted and were not exceptions when the rules were written:',
        formatExceptions(broken),
        'Fix them, or accept one with a reason: archprint allow <rule> <file> --reason "...".',
        'Nothing was written; the rules already in .archprint/ still apply.',
      ].join('\n'),
    );
  }
}
