import { ruleDefinitionKey, type AdoptedRule } from './adopted-rules.js';
import type { Finding } from './check-evaluate.js';

export type RuleChange = 'new' | 'changed';

export interface RulePartition {
  comparable: AdoptedRule[];
  adoptedInChange: { rule: AdoptedRule; change: RuleChange }[];
  removedInChange: AdoptedRule[];
}

export function partitionRules(
  head: readonly AdoptedRule[],
  base: readonly AdoptedRule[] | null,
): RulePartition {
  const baseById = new Map((base ?? []).map((rule) => [rule.id, rule]));
  const headIds = new Set(head.map((rule) => rule.id));
  const partition: RulePartition = {
    comparable: [],
    adoptedInChange: [],
    removedInChange: (base ?? []).filter((rule) => !headIds.has(rule.id)),
  };
  for (const rule of head) {
    const prior = baseById.get(rule.id);
    if (prior === undefined) partition.adoptedInChange.push({ rule, change: 'new' });
    else if (ruleDefinitionKey(prior) !== ruleDefinitionKey(rule))
      partition.adoptedInChange.push({ rule, change: 'changed' });
    else partition.comparable.push(rule);
  }
  return partition;
}

const identity = (finding: Finding): string =>
  [finding.ruleId, finding.file, finding.subject].join('\u0000');

export function renameFinding(finding: Finding, renames: ReadonlyMap<string, string>): Finding {
  return {
    ...finding,
    file: renames.get(finding.file) ?? finding.file,
    subject:
      finding.kind === 'target'
        ? (renames.get(finding.subject) ?? finding.subject)
        : finding.subject,
  };
}

export interface FindingDiff {
  introduced: Finding[];
  fixed: Finding[];
}

function byIdentity(findings: readonly Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = identity(finding);
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  return groups;
}

const inOrder = (a: Finding, b: Finding): number =>
  identity(a).localeCompare(identity(b)) || (a.line ?? 0) - (b.line ?? 0);

/**
 * What the head adds and removes, counting like ESLint's bulk suppressions with the base as the baseline: a
 * finding is new when the head has more of its kind (rule, file, subject) than the base. Then every one of them is
 * listed, since which is the new one cannot be told; fewer than the base means some were fixed.
 */
export function diffFindings(
  base: readonly Finding[],
  head: readonly Finding[],
  renames: ReadonlyMap<string, string>,
): FindingDiff {
  const baseGroups = byIdentity(base.map((finding) => renameFinding(finding, renames)));
  const headGroups = byIdentity(head);
  const introduced: Finding[] = [];
  const fixed: Finding[] = [];
  for (const [key, group] of headGroups) {
    if (group.length > (baseGroups.get(key)?.length ?? 0)) introduced.push(...group);
  }
  for (const [key, group] of baseGroups) {
    const remaining = headGroups.get(key)?.length ?? 0;
    if (group.length > remaining) fixed.push(...group.slice(remaining));
  }
  return { introduced: introduced.sort(inOrder), fixed: fixed.sort(inOrder) };
}
