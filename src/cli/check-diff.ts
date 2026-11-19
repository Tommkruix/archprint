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

/** The lines a file gained in the change. */
export type AddedLines = (file: string) => ReadonlySet<number>;

/**
 * Which findings of a kind the base had `before` of are the new ones: those on lines the change added when there
 * are exactly as many as the count grew by, else every one, since the diff cannot tell them apart.
 */
function newOfKind(group: readonly Finding[], before: number, addedIn?: AddedLines): Finding[] {
  if (before === 0 || addedIn === undefined) return [...group];
  const added = addedIn(group[0]!.file);
  const onAdded = group.filter((finding) => finding.line !== undefined && added.has(finding.line));
  return onAdded.length === group.length - before ? onAdded : [...group];
}

/**
 * What the head adds and removes, counting like ESLint's bulk suppressions with the base as the baseline: a kind
 * (rule, file, subject) has a new finding when the head has more of it than the base, and fewer means some were
 * fixed. `addedIn` tells which of a kind are new; without it every one is listed.
 */
export function diffFindings(
  base: readonly Finding[],
  head: readonly Finding[],
  renames: ReadonlyMap<string, string>,
  addedIn?: AddedLines,
): FindingDiff {
  const baseGroups = byIdentity(base.map((finding) => renameFinding(finding, renames)));
  const headGroups = byIdentity(head);
  const introduced: Finding[] = [];
  const fixed: Finding[] = [];
  for (const [key, group] of headGroups) {
    const before = baseGroups.get(key)?.length ?? 0;
    if (group.length > before) introduced.push(...newOfKind(group, before, addedIn));
  }
  for (const [key, group] of baseGroups) {
    const remaining = headGroups.get(key)?.length ?? 0;
    if (group.length > remaining) fixed.push(...group.slice(remaining));
  }
  return { introduced: introduced.sort(inOrder), fixed: fixed.sort(inOrder) };
}
