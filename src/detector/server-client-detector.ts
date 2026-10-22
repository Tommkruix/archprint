import { readFileSync } from 'node:fs';
import { importLocations } from '../scanner/file-walker.js';
import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { hasUseClientDirective } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

/** The package that marks a module as server-only in React Server Components (Next.js). */
export const SERVER_ONLY_PACKAGE = 'server-only';

export interface ServerClientViolation {
  file: string;
  target: string;
}

export interface ServerClientAnalysis {
  appDir: string;
  clientCount: number;
  /** The "use client" files and the modules importing "server-only", relative to the app. */
  clients: string[];
  serverModules: string[];
  offenderCount: number;
  gate: GateResult;
  violations: ServerClientViolation[];
}

export interface ServerClientOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

export function detectServerClientBoundary(
  appDir: string,
  options: ServerClientOptions = {},
): ServerClientAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const clients = new Set<string>();
  const serverModules = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file.absolutePath, 'utf-8');
    } catch {
      /* v8 ignore next -- defensive: an unreadable file contributes no directive or server marker */
      continue;
    }
    if (hasUseClientDirective(text)) clients.add(file.relativePath);
    if (importLocations(file.absolutePath).some((imp) => imp.specifier === SERVER_ONLY_PACKAGE)) {
      serverModules.add(file.relativePath);
    }
  }

  const offenders = new Set<string>();
  const violations: ServerClientViolation[] = [];
  for (const file of clients) {
    if (serverModules.has(file)) {
      offenders.add(file);
      violations.push({ file, target: SERVER_ONLY_PACKAGE });
    }
    for (const target of adjacency.get(file) ?? []) {
      if (serverModules.has(target)) {
        offenders.add(file);
        violations.push({ file, target });
      }
    }
  }

  return {
    appDir: root,
    clientCount: clients.size,
    clients: [...clients].sort(),
    serverModules: [...serverModules].sort(),
    offenderCount: offenders.size,
    gate: evaluateGate({
      roleFileCount: clients.size,
      violatingFileCount: offenders.size,
      roleConfidence: 1,
      applicable: serverModules.size > 0,
    }),
    violations: violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.target.localeCompare(b.target),
    ),
  };
}
