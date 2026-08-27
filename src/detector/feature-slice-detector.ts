import type { ImportGraph } from '../scanner/import-graph.js';
import type { GateResult } from './confidence-gate.js';
import { detectSiblingIsolation, type SiblingViolation } from './sibling-isolation.js';

/** Directory names that conventionally hold sibling feature slices (feature-sliced / modular designs). */
const CONTAINER_NAMES = new Set(['features', 'modules', 'slices', 'domains']);

export type FeatureSliceViolation = SiblingViolation;

export interface FeatureSliceGroup {
  /** The container directory holding the slices, e.g. `src/features`. */
  container: string;
  /** Distinct sibling slices under the container. */
  sliceCount: number;
  /** Files living in any slice of the container (the role sample). */
  sliceFileCount: number;
  /** Slice files that import a different sibling slice. */
  crossImporterCount: number;
  gate: GateResult;
  violations: FeatureSliceViolation[];
}

export interface FeatureSliceAnalysis {
  appDir: string;
  groups: FeatureSliceGroup[];
}

export interface FeatureSliceDetectorOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

/**
 * Infer feature-slice isolation. A container directory (`features`, `modules`, `slices`, `domains`) holds
 * sibling slices that should not import one another. Each slice file that imports a different sibling slice is
 * a cross-slice violation; the Wilson gate decides whether "slices under <container> must not import each
 * other" is enforceable (AUTO), provisional (SUGGEST), or unsupported. Only containers with at least two
 * slices are considered.
 */
export function detectFeatureSliceIsolation(
  appDir: string,
  options: FeatureSliceDetectorOptions = {},
): FeatureSliceAnalysis {
  const { appDir: root, groups } = detectSiblingIsolation(appDir, CONTAINER_NAMES, options);
  return {
    appDir: root,
    groups: groups.map((group) => ({
      container: group.container,
      sliceCount: group.memberCount,
      sliceFileCount: group.memberFileCount,
      crossImporterCount: group.crossImporterCount,
      gate: group.gate,
      violations: group.violations,
    })),
  };
}
