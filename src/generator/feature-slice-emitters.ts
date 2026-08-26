import type { GenerationStatus } from '../detector/confidence-gate.js';
import type { FeatureSliceGroup } from '../detector/feature-slice-detector.js';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const slug = (container: string): string =>
  container.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

const confidencePct = (group: FeatureSliceGroup): string =>
  `${(group.gate.conditions.confidence.value * 100).toFixed(0)}%`;

export interface CrossSliceRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  /** Files in a slice; the `([^/]+)` captures the slice name as $1. */
  from: { path: string };
  /** Files in a different sibling slice: same container, but not the captured slice. */
  to: { path: string; pathNot: string };
}

export interface CrossSliceConfig {
  forbidden: CrossSliceRule[];
}

/**
 * Emit inferred feature-slice isolation as a dependency-cruiser `forbidden` ruleset. For each container, a
 * file in one slice may not import a different sibling slice; the rule captures the source slice with a group
 * and forbids the other slices via a `$1` back-reference. Only AUTO groups by default.
 */
export function toDependencyCruiserFeatureSlice(
  groups: readonly FeatureSliceGroup[],
  include: readonly GenerationStatus[] = ['AUTO'],
): CrossSliceConfig {
  const forbidden = groups
    .filter((group) => include.includes(group.gate.status))
    .map((group) => {
      const container = escapeRegExp(group.container);
      return {
        name: `no-cross-slice-${slug(group.container)}`,
        comment: `Archprint inferred slice isolation: the ${group.sliceCount} slices under "${group.container}" do not import each other (${group.sliceFileCount - group.crossImporterCount}/${group.sliceFileCount} slice files conform); cross-slice imports are forbidden (confidence ${confidencePct(group)}).`,
        severity: 'error' as const,
        from: { path: `^${container}/([^/]+)/` },
        to: { path: `^${container}/([^/]+)/`, pathNot: `^${container}/$1/` },
      };
    });
  return { forbidden };
}
