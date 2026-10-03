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

export function diffFindings(
  base: readonly Finding[],
  head: readonly Finding[],
  renames: ReadonlyMap<string, string>,
): FindingDiff {
  const renamedBase = base.map((finding) => renameFinding(finding, renames));
  const baseKeys = new Set(renamedBase.map(identity));
  const headKeys = new Set(head.map(identity));
  const byIdentity = (a: Finding, b: Finding): number => identity(a).localeCompare(identity(b));
  return {
    introduced: head.filter((finding) => !baseKeys.has(identity(finding))).sort(byIdentity),
    fixed: renamedBase.filter((finding) => !headKeys.has(identity(finding))).sort(byIdentity),
  };
}
