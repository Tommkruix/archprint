import type { LayerBoundary } from '../detector/layer-detector.js';

export interface LayerGraphEdge {
  from: string;
  to: string;
  weight: number;
  leak: boolean;
}

export function layerGraphEdges(boundaries: readonly LayerBoundary[]): LayerGraphEdge[] {
  const edges: LayerGraphEdge[] = [];
  for (const boundary of boundaries) {
    if (boundary.reverseFlow > 0) {
      edges.push({
        from: boundary.to,
        to: boundary.from,
        weight: boundary.reverseFlow,
        leak: false,
      });
    }
    if (boundary.stats.violatingFileCount > 0) {
      edges.push({
        from: boundary.from,
        to: boundary.to,
        weight: boundary.stats.violatingFileCount,
        leak: true,
      });
    }
  }
  return edges.sort(
    (a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || Number(a.leak) - Number(b.leak),
  );
}

const graphNodes = (edges: readonly LayerGraphEdge[]): string[] =>
  [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort();

export function toMermaid(boundaries: readonly LayerBoundary[]): string {
  const edges = layerGraphEdges(boundaries);
  const nodes = graphNodes(edges);
  const id = new Map<string, string>(nodes.map((node, index) => [node, `n${index}`]));

  const lines = ['graph LR'];
  for (const node of nodes) lines.push(`  ${id.get(node)!}["${node}"]`);
  edges.forEach((edge) => {
    const from = id.get(edge.from)!;
    const to = id.get(edge.to)!;
    lines.push(
      edge.leak
        ? `  ${from} -. "${edge.weight} ⚠" .-> ${to}`
        : `  ${from} -->|${edge.weight}| ${to}`,
    );
  });
  return lines.join('\n');
}

const dotId = (layer: string): string => `"${layer.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function toGraphviz(boundaries: readonly LayerBoundary[]): string {
  const edges = layerGraphEdges(boundaries);
  const nodes = graphNodes(edges);

  const lines = ['digraph archprint {', '  rankdir=LR;', '  node [shape=box];'];
  for (const node of nodes) lines.push(`  ${dotId(node)};`);
  for (const edge of edges) {
    const attrs = edge.leak
      ? `[label="${edge.weight}", style=dashed, color=red]`
      : `[label="${edge.weight}"]`;
    lines.push(`  ${dotId(edge.from)} -> ${dotId(edge.to)} ${attrs};`);
  }
  lines.push('}');
  return lines.join('\n');
}
