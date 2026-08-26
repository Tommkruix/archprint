import {
  buildImportGraph,
  type ImportGraph,
  stronglyConnectedComponents,
} from '../scanner/import-graph.js';
import { layerOfPath } from './layer-detector.js';

export interface ReachabilityAnalysis {
  appDir: string;
  layers: string[];
  /** layer -> every layer a file in it can reach through one or more value imports (transitive closure). */
  reaches: Map<string, Set<string>>;
}

export interface ReachabilityOptions {
  resolve?: boolean;
  /** A prebuilt graph to analyze, so a caller running several detectors builds the graph once. */
  graph?: ImportGraph;
}

/**
 * Compute transitive layer reachability. Files are condensed by strongly-connected component into a DAG, the
 * DAG's reachable-set is memoized, then lifted to layers: `reaches.get(A)` holds every layer some file in A
 * can reach through a chain of value imports. Files inside one cyclic component reach each other's layers.
 */
export function computeLayerReachability(
  appDir: string,
  options: ReachabilityOptions = {},
): ReachabilityAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const components = stronglyConnectedComponents(
    files.map((file) => file.relativePath),
    adjacency,
  );
  const componentOf = new Map<string, number>();
  components.forEach((component, id) => {
    for (const node of component) componentOf.set(node, id);
  });

  const selfLoop = new Set<string>(
    files.map((f) => f.relativePath).filter((node) => adjacency.get(node)?.includes(node)),
  );
  const cyclic = components.map(
    (component) => component.length > 1 || (component.length === 1 && selfLoop.has(component[0]!)),
  );

  const layersIn: Set<string>[] = components.map((component) => {
    const set = new Set<string>();
    for (const node of component) {
      const layer = layerOfPath(node);
      if (layer !== null) set.add(layer);
    }
    return set;
  });

  const successors: Set<number>[] = components.map(() => new Set<number>());
  for (const file of files) {
    const from = componentOf.get(file.relativePath)!;
    for (const target of adjacency.get(file.relativePath) ?? []) {
      const to = componentOf.get(target);
      if (to !== undefined && to !== from) successors[from]!.add(to);
    }
  }

  // Tarjan emits components in reverse topological order, so every successor has a lower id than its
  // predecessor. Accumulating in a single forward pass therefore needs no recursion (stack-safe at scale).
  const reachableComps: Set<number>[] = components.map(() => new Set<number>());
  components.forEach((_component, id) => {
    for (const next of successors[id]!) {
      reachableComps[id]!.add(next);
      for (const deep of reachableComps[next]!) reachableComps[id]!.add(deep);
    }
  });

  const reaches = new Map<string, Set<string>>();
  const layers = new Set<string>();
  components.forEach((_component, id) => {
    const reachedLayers = new Set<string>();
    for (const compId of reachableComps[id]!) {
      for (const layer of layersIn[compId]!) reachedLayers.add(layer);
    }
    if (cyclic[id]) {
      for (const layer of layersIn[id]!) reachedLayers.add(layer);
    }
    for (const layer of layersIn[id]!) {
      layers.add(layer);
      const set = reaches.get(layer) ?? new Set<string>();
      for (const reached of reachedLayers) set.add(reached);
      reaches.set(layer, set);
    }
  });

  return { appDir: root, layers: [...layers].sort(), reaches };
}

/** Whether a file in `from` can reach `to` through a chain of value imports (transitively). */
export function reachesLayer(analysis: ReachabilityAnalysis, from: string, to: string): boolean {
  return analysis.reaches.get(from)?.has(to) ?? false;
}
