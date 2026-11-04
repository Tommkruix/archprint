import { importPair } from '../generator/eslint-app-emitter.js';
import type { AdoptedRule } from './adopted-rules.js';
import type { Finding } from './check-evaluate.js';
import type { RuleExceptions } from './ratchet.js';

/** How the exceptions recorded with the adopted rules stand after a change. */
export interface ExceptionBurnDown {
  /** Recorded exceptions that still break their rule. */
  left: number;
  /** Exceptions recorded before the change that broke their rule then and no longer do. */
  fixedInChange: RuleExceptions[];
  /** Exceptions still recorded that no longer break their rule, which the next generate enforces. */
  stillRecorded: RuleExceptions[];
}

const keyOf = (rule: AdoptedRule, finding: Finding): string =>
  rule.family === 'entry-purity' ? importPair(finding.file, finding.subject) : finding.file;

const renamed = (key: string, renames: ReadonlyMap<string, string>): string =>
  key
    .split(' -> ')
    .map((part) => renames.get(part) ?? part)
    .join(' -> ');

export function exceptionBurnDown(
  rules: readonly AdoptedRule[],
  baseRules: readonly AdoptedRule[] | null,
  baseFindings: readonly Finding[],
  headFindings: readonly Finding[],
  renames: ReadonlyMap<string, string>,
): ExceptionBurnDown {
  const baseById = new Map((baseRules ?? []).map((rule) => [rule.id, rule]));
  const breaking = (rule: AdoptedRule, findings: readonly Finding[]): Set<string> =>
    new Set(
      findings
        .filter((finding) => finding.ruleId === rule.id)
        .map((finding) => renamed(keyOf(rule, finding), renames)),
    );
  const burnDown: ExceptionBurnDown = { left: 0, fixedInChange: [], stillRecorded: [] };
  for (const rule of rules) {
    const now = breaking(rule, headFindings);
    const before = breaking(rule, baseFindings);
    const recorded = (rule.exceptions ?? []).map((key) => renamed(key, renames));
    burnDown.left += recorded.filter((key) => now.has(key)).length;
    const stillRecorded = recorded.filter((key) => !now.has(key));
    if (stillRecorded.length > 0)
      burnDown.stillRecorded.push({ rule: rule.id, exceptions: stillRecorded });
    const fixed = (baseById.get(rule.id)?.exceptions ?? [])
      .map((key) => renamed(key, renames))
      .filter((key) => before.has(key) && !now.has(key));
    if (fixed.length > 0) burnDown.fixedInChange.push({ rule: rule.id, exceptions: fixed });
  }
  return burnDown;
}

const count = (entries: readonly RuleExceptions[]): number =>
  entries.reduce((total, entry) => total + entry.exceptions.length, 0);

/** The burn-down as lines of text, or none when no rule records an exception. */
export function describeBurnDown({
  left,
  fixedInChange,
  stillRecorded,
}: ExceptionBurnDown): string[] {
  const fixed = count(fixedInChange);
  if (left === 0 && fixed === 0 && stillRecorded.length === 0) return [];
  const lines = [`Exceptions: ${left} left${fixed > 0 ? `, ${fixed} fixed in this change` : ''}.`];
  for (const { rule, exceptions } of fixedInChange)
    lines.push(`  ${rule}: ${exceptions.join(', ')}`);
  if (stillRecorded.length > 0)
    lines.push(
      `${count(stillRecorded)} fixed exception(s) are still recorded; run archprint generate to enforce the rules on them.`,
    );
  return lines;
}
