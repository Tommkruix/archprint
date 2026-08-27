import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type LayerBoundary,
  layerGraphEdges,
  toGraphviz,
  toMermaid,
} from '../../src/index.js';

function boundary(
  from: string,
  to: string,
  roleFileCount: number,
  reverseFlow = 20,
  violatingFileCount = 0,
): LayerBoundary {
  const gate = evaluateGate({ roleFileCount, violatingFileCount, roleConfidence: 1 });
  return {
    id: 'AP-LAYER',
    name: `no-import:${from}->${to}`,
    from,
    to,
    description: 'x',
    stats: {
      roleFileCount,
      conformingFileCount: roleFileCount - violatingFileCount,
      violatingFileCount,
      ratio: (roleFileCount - violatingFileCount) / roleFileCount,
      roleConfidence: 1,
    },
    gate,
    violations: [],
    reverseFlow,
  };
}

describe('layerGraphEdges', () => {
  it('emits the dominant flow as to -> from, and a leak edge only when there are violations', () => {
    const clean = layerGraphEdges([boundary('utils', 'components', 40, 20, 0)]);
    expect(clean).toEqual([{ from: 'components', to: 'utils', weight: 20, leak: false }]);

    const leaky = layerGraphEdges([boundary('utils', 'components', 40, 20, 2)]);
    expect(leaky).toContainEqual({ from: 'components', to: 'utils', weight: 20, leak: false });
    expect(leaky).toContainEqual({ from: 'utils', to: 'components', weight: 2, leak: true });
  });

  it('omits a boundary with no reverse flow and no violations', () => {
    expect(layerGraphEdges([boundary('a', 'b', 40, 0, 0)])).toEqual([]);
  });
});

describe('toMermaid', () => {
  it('renders nodes and a solid dominant arrow', () => {
    const mermaid = toMermaid([boundary('utils', 'components', 40, 20, 0)]);
    expect(mermaid.startsWith('graph LR')).toBe(true);
    expect(mermaid).toContain('["components"]');
    expect(mermaid).toContain('["utils"]');
    expect(mermaid).toMatch(/n\d+ -->\|20\| n\d+/);
  });

  it('renders a leak as a dotted arrow', () => {
    const mermaid = toMermaid([boundary('utils', 'components', 40, 20, 2)]);
    expect(mermaid).toMatch(/n\d+ -\. "2 ⚠" \.-> n\d+/);
  });
});

describe('toGraphviz', () => {
  it('renders a DOT digraph with a labeled dominant edge', () => {
    const dot = toGraphviz([boundary('utils', 'components', 40, 20, 0)]);
    expect(dot).toContain('digraph archprint {');
    expect(dot).toContain('rankdir=LR;');
    expect(dot).toContain('"components" -> "utils" [label="20"];');
    expect(dot.endsWith('}')).toBe(true);
  });

  it('renders a leak as a dashed red edge', () => {
    const dot = toGraphviz([boundary('utils', 'components', 40, 20, 2)]);
    expect(dot).toContain('"utils" -> "components" [label="2", style=dashed, color=red];');
  });
});
