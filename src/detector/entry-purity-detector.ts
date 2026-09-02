import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { type Role } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const ENTRY_ROLES: ReadonlySet<Role> = new Set(['ROUTE_ENTRY', 'ROUTE_HANDLER', 'API_HANDLER']);

export interface EntryImportViolation {
  file: string;
  importer: string;
}

export interface EntryPurityAnalysis {
  appDir: string;
  entryCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: EntryImportViolation[];
}

export interface EntryPurityOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

export function detectEntryPurity(
  appDir: string,
  options: EntryPurityOptions = {},
): EntryPurityAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const entries = new Set(
    files.filter((file) => ENTRY_ROLES.has(file.role)).map((file) => file.relativePath),
  );
  const importerOf = new Map<string, string>();
  for (const [file, targets] of adjacency) {
    if (entries.has(file)) continue;
    for (const target of targets) {
      if (entries.has(target) && !importerOf.has(target)) importerOf.set(target, file);
    }
  }

  const violations: EntryImportViolation[] = [...importerOf.entries()]
    .map(([file, importer]) => ({ file, importer }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return {
    appDir: root,
    entryCount: entries.size,
    offenderCount: violations.length,
    gate: evaluateGate({
      roleFileCount: entries.size,
      violatingFileCount: violations.length,
      roleConfidence: 1,
    }),
    violations,
  };
}
