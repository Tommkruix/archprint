import {
  buildImportGraph,
  type ImportGraph,
  stronglyConnectedComponents,
} from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

export interface ImportCycle {
  /** Every file in the group; each reaches every other through imports. */
  files: string[];
  /** One real import loop through the group, closed: the first file repeats at the end. */
  path: string[];
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

/** The shortest import loop from `start` back to itself that stays inside `members`. */
function shortestLoop(
  start: string,
  members: ReadonlySet<string>,
  adjacency: Map<string, string[]>,
): string[] {
  const cameFrom = new Map<string, string>();
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of [...(adjacency.get(node) ?? [])].sort()) {
      if (!members.has(next) || (next === start && node === start)) continue;
      if (next === start) {
        const loop = [start];
        for (let at = node; at !== start; at = cameFrom.get(at)!) loop.splice(1, 0, at);
        return [...loop, start];
      }
      if (!cameFrom.has(next)) {
        cameFrom.set(next, node);
        queue.push(next);
      }
    }
  }
  return [start, start];
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
      cycles.push({ files: ordered, path: shortestLoop(ordered[0]!, new Set(ordered), adjacency) });
      for (const file of ordered) cyclicFiles.add(file);
    }
  }
  for (const node of selfImports) {
    cycles.push({ files: [node], path: [node, node] });
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
