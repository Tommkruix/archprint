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
  from: { path: string };
  to: { path: string; pathNot: string };
}

export interface CrossSliceConfig {
  forbidden: CrossSliceRule[];
}

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
