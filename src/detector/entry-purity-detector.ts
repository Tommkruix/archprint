import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { type Role } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

/** Files the framework loads itself: pages, layouts, route and API handlers. */
export const ENTRY_ROLES: readonly Role[] = ['ROUTE_ENTRY', 'ROUTE_HANDLER', 'API_HANDLER'];

export interface EntryImportViolation {
  file: string;
  importer: string;
}

export interface EntryPurityAnalysis {
  appDir: string;
  entryCount: number;
  /** Every import of a framework entry from a file that is not one. */
  imports: EntryImportViolation[];
  offenderCount: number;
  gate: GateResult;
  violations: EntryImportViolation[];
}

/** One violation per imported entry: its first importer in path order. */
export function importedEntries(imports: readonly EntryImportViolation[]): EntryImportViolation[] {
  const firstImporter = new Map<string, string>();
  for (const { file, importer } of imports) {
    const known = firstImporter.get(file);
    if (known === undefined || importer < known) firstImporter.set(file, importer);
  }
  return [...firstImporter]
    .map(([file, importer]) => ({ file, importer }))
    .sort((a, b) => a.file.localeCompare(b.file));
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
    files.filter((file) => ENTRY_ROLES.includes(file.role)).map((file) => file.relativePath),
  );
  const imports: EntryImportViolation[] = [];
  for (const [file, targets] of adjacency) {
    if (entries.has(file)) continue;
    for (const target of targets)
      if (entries.has(target)) imports.push({ file: target, importer: file });
  }
  const violations = importedEntries(imports);

  return {
    appDir: root,
    entryCount: entries.size,
    imports: imports.sort(
      (a, b) => a.file.localeCompare(b.file) || a.importer.localeCompare(b.importer),
    ),
    offenderCount: violations.length,
    gate: evaluateGate({
      roleFileCount: entries.size,
      violatingFileCount: violations.length,
      roleConfidence: 1,
    }),
    violations,
  };
}
