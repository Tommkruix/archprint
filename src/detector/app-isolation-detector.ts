import type { ImportGraph } from '../scanner/import-graph.js';
import type { GateResult } from './confidence-gate.js';
import { detectSiblingIsolation, type SiblingViolation } from './sibling-isolation.js';

const CONTAINER_NAMES = new Set(['apps', 'services']);

export type AppImportViolation = SiblingViolation;

export interface AppIsolationGroup {
  container: string;
  appCount: number;
  appFileCount: number;
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
