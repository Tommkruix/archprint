import type { GateResult } from '../detector/confidence-gate.js';
import { appIsolationRuleName } from '../generator/app-isolation-emitters.js';
import { featureSliceRuleName } from '../generator/feature-slice-emitters.js';
import { layerRuleName } from '../generator/layer-emitters.js';
import { publicApiRuleName } from '../generator/public-api-emitters.js';
import { roleLayeringRuleName } from '../generator/role-layering-emitters.js';
import type { ScanResult } from './scan.js';
import { findRule } from './rule-ref.js';
import { collectGates, SINGLE_ANALYSES, SINGLE_RULE_IDS } from './summary.js';

/**
 * The scan as generate enforces it: each named rule that is SUGGEST counts as AUTO, so it is written with its
 * current breaks exempt. Its counts and violations stay as measured, and `promotedFrom` keeps its real status.
 */
export function promoteBelowGate(scan: ScanResult, ids: ReadonlySet<string>): ScanResult {
  const promote = <T extends { gate: GateResult }>(item: T, id: string): T =>
    ids.has(id) && item.gate.status === 'SUGGEST'
      ? { ...item, gate: { ...item.gate, status: 'AUTO', promotedFrom: 'SUGGEST' } }
      : item;
  const singles = Object.fromEntries(
    Object.entries(SINGLE_ANALYSES).map(([family, key]) => [
      key,
      promote(scan[key], SINGLE_RULE_IDS[family as keyof typeof SINGLE_ANALYSES]),
    ]),
  ) as Partial<ScanResult>;
  return {
    ...scan,
    ...singles,
    patterns: scan.patterns.map((pattern) => ({
      ...pattern,
      result: promote(pattern.result, pattern.config.id),
    })),
    layerBoundaries: scan.layerBoundaries.map((boundary) =>
      promote(boundary, layerRuleName(boundary)),
    ),
    roleLayering: {
      ...scan.roleLayering,
      boundaries: scan.roleLayering.boundaries.map((boundary) =>
        promote(boundary, roleLayeringRuleName(boundary.from, boundary.to)),
      ),
    },
    publicApi: {
      ...scan.publicApi,
      groups: scan.publicApi.groups.map((group) => promote(group, publicApiRuleName(group.dir))),
    },
    featureSlices: {
      ...scan.featureSlices,
      groups: scan.featureSlices.groups.map((group) =>
        promote(group, featureSliceRuleName(group.container)),
      ),
    },
    appIsolation: {
      ...scan.appIsolation,
      groups: scan.appIsolation.groups.map((group) =>
        promote(group, appIsolationRuleName(group.container)),
      ),
    },
  };
}

export class BaselineError extends Error {}

/** The ids of the rules named with `--baseline`; a rule the code does not follow (REJECT) cannot be adopted. */
export function baselineRuleIds(scan: ScanResult, refs: readonly string[]): string[] {
  const gates = collectGates(scan);
  return refs.flatMap((ref) => {
    const entry = findRule(ref, gates);
    if (entry === undefined) return [];
    if (entry.gate.status === 'REJECT') {
      throw new BaselineError(
        `${entry.id} cannot be adopted, even with --baseline: the code does not follow it closely enough (${(entry.gate.observedConformance * 100).toFixed(1)}% of the files it applies to). Review it with 'archprint explain ${entry.id}'.`,
      );
    }
    return [entry.id];
  });
}
