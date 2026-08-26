import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildImportGraph } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// entry.ts imports a relative file, an aliased file, an external package, and a dynamic aliased import.
const fixture = path.join(here, '..', 'fixtures', 'import-graph');

const edgesFrom = (graph: ReturnType<typeof buildImportGraph>, file: string): string[] =>
  [...(graph.adjacency.get(file) ?? [])].sort();

describe('buildImportGraph', () => {
  it('resolves relative and alias imports to first-party files and drops externals', () => {
    const graph = buildImportGraph(fixture);
    expect(graph.files).toHaveLength(4);
    const edges = edgesFrom(graph, 'entry.ts');
    expect(edges).toContain('rel.ts');
    expect(edges).toContain('aliased.ts');
    expect(edges).toContain('dynamic.ts');
    // node:path is external and must not appear as a first-party edge.
    expect(edges.some((edge) => edge.includes('path'))).toBe(false);
  });

  it('normalizes a relative appDir to an absolute root', () => {
    const relative = path.relative(process.cwd(), fixture);
    const graph = buildImportGraph(relative);
    expect(path.isAbsolute(graph.root)).toBe(true);
    expect(edgesFrom(graph, 'entry.ts')).toContain('rel.ts');
  });

  it('fast and deep modes resolve the same first-party edges', () => {
    const fast = edgesFrom(buildImportGraph(fixture, { resolve: false }), 'entry.ts');
    const deep = edgesFrom(buildImportGraph(fixture, { resolve: true }), 'entry.ts');
    expect(deep).toEqual(fast);
  });

  it('drops a type-only import (erased at compile time) but keeps the value edge', () => {
    const graph = buildImportGraph(path.join(here, '..', 'fixtures', 'type-only-graph'));
    const edges = edgesFrom(graph, 'entry.ts');
    expect(edges).toContain('v.ts');
    expect(edges).not.toContain('t.ts');
  });
});
