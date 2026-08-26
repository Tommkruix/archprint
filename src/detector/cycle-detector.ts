import {
  buildImportGraph,
  type ImportGraph,
  stronglyConnectedComponents,
} from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

export interface ImportCycle {
  /** The files that form the cycle (a strongly connected component of size > 1, or a self-import). */
  files: string[];
}

export interface CycleAnalysis {
  appDir: string;
  fileCount: number;
  cycles: ImportCycle[];
  filesInCycles: number;
  /** Gate on adopting a "no circular dependencies" rule, given how clean the repo already is. */
  gate: GateResult;
}

export interface CycleDetectorOptions {
  /** Resolve the graph with the type checker (deep). Default false: fast file resolution. */
  resolve?: boolean;
  /** A prebuilt graph to analyze, so a caller running several detectors builds the graph once. */
  graph?: ImportGraph;
}

/**
 * Detect circular import dependencies in an app-dir. Builds the first-party value-import graph, finds every
 * strongly connected component of size > 1 (plus self-imports), and gates a "no circular dependencies" rule
 * on how much of the repo is already cycle-free: a clean, well-observed repo reaches AUTO; one riddled with
 * cycles stays SUGGEST.
 */
export function detectCycles(appDir: string, options: CycleDetectorOptions = {}): CycleAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });
  const nodes = files.map((file) => file.relativePath);
  const selfImports = new Set(nodes.filter((node) => adjacency.get(node)?.includes(node)));
  const cycles: ImportCycle[] = [];
  const cyclicFiles = new Set<string>();
  for (const component of stronglyConnectedComponents(nodes, adjacency)) {
    if (component.length > 1) {
      const ordered = [...component].sort();
      cycles.push({ files: ordered });
      for (const file of ordered) cyclicFiles.add(file);
    }
  }
  for (const node of selfImports) {
    cycles.push({ files: [node] });
    cyclicFiles.add(node);
  }

  const gate = evaluateGate({
    roleFileCount: nodes.length,
    violatingFileCount: cyclicFiles.size,
    roleConfidence: 1,
  });

  return {
    appDir: root,
    fileCount: nodes.length,
    cycles,
    filesInCycles: cyclicFiles.size,
    gate,
  };
}
