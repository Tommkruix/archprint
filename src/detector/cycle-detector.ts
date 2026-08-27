import {
  buildImportGraph,
  type ImportGraph,
  stronglyConnectedComponents,
} from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

export interface ImportCycle {
  files: string[];
}

export interface CycleAnalysis {
  appDir: string;
  fileCount: number;
  cycles: ImportCycle[];
  filesInCycles: number;
  gate: GateResult;
}

export interface CycleDetectorOptions {
  resolve?: boolean;
  graph?: ImportGraph;
}

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
