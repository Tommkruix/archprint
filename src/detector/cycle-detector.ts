import { buildImportGraph } from '../scanner/import-graph.js';
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
}

/** Iterative Tarjan strongly-connected-components (iterative to stay safe on large, deep graphs). */
function stronglyConnectedComponents(
  nodes: readonly string[],
  adjacency: Map<string, string[]>,
): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const componentStack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const start of nodes) {
    if (index.has(start)) continue;
    const work: { node: string; next: number }[] = [{ node: start, next: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const node = frame.node;
      if (frame.next === 0) {
        index.set(node, counter);
        lowLink.set(node, counter);
        counter += 1;
        componentStack.push(node);
        onStack.add(node);
      }
      const neighbours = adjacency.get(node) ?? [];
      if (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next]!;
        frame.next += 1;
        if (!index.has(neighbour)) {
          work.push({ node: neighbour, next: 0 });
        } else if (onStack.has(neighbour)) {
          lowLink.set(node, Math.min(lowLink.get(node)!, index.get(neighbour)!));
        }
      } else {
        if (lowLink.get(node) === index.get(node)) {
          const component: string[] = [];
          let popped: string;
          do {
            popped = componentStack.pop()!;
            onStack.delete(popped);
            component.push(popped);
          } while (popped !== node);
          result.push(component);
        }
        work.pop();
        const parent = work[work.length - 1]?.node;
        if (parent !== undefined) {
          lowLink.set(parent, Math.min(lowLink.get(parent)!, lowLink.get(node)!));
        }
      }
    }
  }
  return result;
}

/**
 * Detect circular import dependencies in an app-dir. Builds the first-party value-import graph, finds every
 * strongly connected component of size > 1 (plus self-imports), and gates a "no circular dependencies" rule
 * on how much of the repo is already cycle-free: a clean, well-observed repo reaches AUTO; one riddled with
 * cycles stays SUGGEST.
 */
export function detectCycles(appDir: string, options: CycleDetectorOptions = {}): CycleAnalysis {
  const { root, files, adjacency } = buildImportGraph(appDir, {
    resolve: options.resolve ?? false,
  });
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
