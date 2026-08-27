import type { ImportGraph } from '../scanner/import-graph.js';
import type { GateResult } from './confidence-gate.js';
import { detectSiblingIsolation, type SiblingViolation } from './sibling-isolation.js';

const CONTAINER_NAMES = new Set(['features', 'modules', 'slices', 'domains']);

export type FeatureSliceViolation = SiblingViolation;

export interface FeatureSliceGroup {
  container: string;
  sliceCount: number;
  sliceFileCount: number;
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
