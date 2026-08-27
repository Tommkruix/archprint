import type { ImportGraph } from '../scanner/import-graph.js';
import type { GateResult } from './confidence-gate.js';
import { detectSiblingIsolation, type SiblingViolation } from './sibling-isolation.js';

/** Directory names that conventionally hold sibling deployable apps in a monorepo. */
const CONTAINER_NAMES = new Set(['apps', 'services']);

export type AppImportViolation = SiblingViolation;

export interface AppIsolationGroup {
  /** The container directory holding the apps, e.g. `apps`. */
  container: string;
  /** Distinct sibling apps under the container. */
  appCount: number;
  /** Files living in any app of the container (the role sample). */
  appFileCount: number;
  /** App files that import a different sibling app directly. */
  crossImporterCount: number;
  gate: GateResult;
  violations: AppImportViolation[];
}

export interface AppIsolationAnalysis {
  appDir: string;
  groups: AppIsolationGroup[];
}

export interface AppIsolationDetectorOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

/**
 * Infer monorepo app isolation. Sibling apps under an `apps`/`services` container should not import each
 * other directly (they communicate through shared packages, not by reaching into a sibling's source). Each app
 * file that imports a different sibling app is a violation; the Wilson gate decides whether "apps under
 * <container> must not import each other" is enforceable. Only containers with at least two apps are counted.
 */
export function detectAppIsolation(
  appDir: string,
  options: AppIsolationDetectorOptions = {},
): AppIsolationAnalysis {
  const { appDir: root, groups } = detectSiblingIsolation(appDir, CONTAINER_NAMES, options);
  return {
    appDir: root,
    groups: groups.map((group) => ({
      container: group.container,
      appCount: group.memberCount,
      appFileCount: group.memberFileCount,
      crossImporterCount: group.crossImporterCount,
      gate: group.gate,
      violations: group.violations,
    })),
  };
}
