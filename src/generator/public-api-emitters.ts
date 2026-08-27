import type { GenerationStatus } from '../detector/confidence-gate.js';
import type { PublicApiGroup } from '../detector/public-api-detector.js';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const slug = (dir: string): string => dir.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

const confidencePct = (group: PublicApiGroup): string =>
  `${(group.gate.conditions.confidence.value * 100).toFixed(0)}%`;

export interface DeepImportRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { pathNot: string };
  to: { path: string; pathNot: string };
}

export interface DeepImportConfig {
  forbidden: DeepImportRule[];
}

export function toDependencyCruiserPublicApi(
  groups: readonly PublicApiGroup[],
  include: readonly GenerationStatus[] = ['AUTO'],
): DeepImportConfig {
  const forbidden = groups
    .filter((group) => include.includes(group.gate.status))
    .map((group) => {
      const dir = escapeRegExp(group.dir);
      return {
        name: `no-deep-import-${slug(group.dir)}`,
        comment: `Archprint inferred public API: files outside "${group.dir}" import it through its barrel (${group.consumerCount - group.deepImporterCount}/${group.consumerCount} consumers); deep imports into its internals are forbidden (confidence ${confidencePct(group)}).`,
        severity: 'error' as const,
        from: { pathNot: `^${dir}/` },
        to: { path: `^${dir}/`, pathNot: `^${dir}/index\\.(ts|tsx)$` },
      };
    });
  return { forbidden };
}
