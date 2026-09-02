import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { classifyFile, type Role } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const DATA_ROLES: ReadonlySet<Role> = new Set(['DB_MODULE', 'DATA_ACCESS']);

export interface UiDataViolation {
  file: string;
  target: string;
}

export interface UiDataIsolationAnalysis {
  appDir: string;
  componentCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: UiDataViolation[];
}

export interface UiDataIsolationOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

export function detectUiDataIsolation(
  appDir: string,
  options: UiDataIsolationOptions = {},
): UiDataIsolationAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const components = files.filter((file) => classifyFile(file.relativePath).role === 'COMPONENT');
  const dataFiles = new Set(
    files
      .filter((file) => DATA_ROLES.has(classifyFile(file.relativePath).role))
      .map((file) => file.relativePath),
  );

  const offenders = new Set<string>();
  const violations: UiDataViolation[] = [];
  for (const component of components) {
    for (const target of adjacency.get(component.relativePath) ?? []) {
      if (dataFiles.has(target)) {
        offenders.add(component.relativePath);
        violations.push({ file: component.relativePath, target });
      }
    }
  }

  return {
    appDir: root,
    componentCount: components.length,
    offenderCount: offenders.size,
    gate: evaluateGate({
      roleFileCount: components.length,
      violatingFileCount: offenders.size,
      roleConfidence: dataFiles.size > 0 ? 1 : 0,
    }),
    violations: violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.target.localeCompare(b.target),
    ),
  };
}
