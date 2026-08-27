import type { GenerationStatus } from '../detector/confidence-gate.js';
import type { AppIsolationGroup } from '../detector/app-isolation-detector.js';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const slug = (container: string): string =>
  container.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

const confidencePct = (group: AppIsolationGroup): string =>
  `${(group.gate.conditions.confidence.value * 100).toFixed(0)}%`;

export interface CrossAppRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  /** Files in an app; the `([^/]+)` captures the app name as $1. */
  from: { path: string };
  /** Files in a different sibling app: same container, but not the captured app. */
  to: { path: string; pathNot: string };
}

export interface CrossAppConfig {
  forbidden: CrossAppRule[];
}

/**
 * Emit inferred app isolation as a dependency-cruiser `forbidden` ruleset. For each container, a file in one
 * app may not import a different sibling app; the rule captures the source app with a group and forbids the
 * others via a `$1` back-reference. Only AUTO groups by default.
 */
export function toDependencyCruiserAppIsolation(
  groups: readonly AppIsolationGroup[],
  include: readonly GenerationStatus[] = ['AUTO'],
): CrossAppConfig {
  const forbidden = groups
    .filter((group) => include.includes(group.gate.status))
    .map((group) => {
      const container = escapeRegExp(group.container);
      return {
        name: `no-cross-app-${slug(group.container)}`,
        comment: `Archprint inferred app isolation: the ${group.appCount} apps under "${group.container}" do not import each other (${group.appFileCount - group.crossImporterCount}/${group.appFileCount} app files conform); cross-app imports are forbidden (confidence ${confidencePct(group)}).`,
        severity: 'error' as const,
        from: { path: `^${container}/([^/]+)/` },
        to: { path: `^${container}/([^/]+)/`, pathNot: `^${container}/$1/` },
      };
    });
  return { forbidden };
}
