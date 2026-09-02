import { readFileSync } from 'node:fs';
import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { hasUseClientDirective } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const SERVER_ONLY = /(^|[^.\w])['"]server-only['"]/;

export interface ServerClientViolation {
  file: string;
  target: string;
}

export interface ServerClientAnalysis {
  appDir: string;
  clientCount: number;
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
    if (SERVER_ONLY.test(text)) serverModules.add(file.relativePath);
  }

  const offenders = new Set<string>();
  const violations: ServerClientViolation[] = [];
  for (const file of clients) {
    if (serverModules.has(file)) {
      offenders.add(file);
      violations.push({ file, target: 'server-only' });
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
