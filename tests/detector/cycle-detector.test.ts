import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildImportGraph } from '../../src/scanner/import-graph.js';
import { detectCycles } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cyclesFixture = path.join(here, '..', 'fixtures', 'cycles');
const acyclicFixture = path.join(here, '..', 'fixtures', 'layers');
const selfImportFixture = path.join(here, '..', 'fixtures', 'self-import');
const hubFixture = path.join(here, '..', 'fixtures', 'cycle-hub');
const selfMemberFixture = path.join(here, '..', 'fixtures', 'cycle-self-member');

describe('detectCycles', () => {
  it('finds a circular import between two files', () => {
    const analysis = detectCycles(cyclesFixture);
    expect(analysis.fileCount).toBe(4);
    expect(analysis.filesInCycles).toBe(2);
    expect(analysis.cycles).toHaveLength(1);
    expect(analysis.cycles[0]!.files).toEqual(['a.ts', 'b.ts']);
    expect(analysis.cycles[0]!.path).toEqual(['a.ts', 'b.ts', 'a.ts']);
  });

  it('gates no-circular-dependencies below AUTO when much of the repo is cyclic', () => {
    expect(detectCycles(cyclesFixture).gate.status).not.toBe('AUTO');
  });

  it('reports no cycles in an acyclic repo', () => {
    const analysis = detectCycles(acyclicFixture);
    expect(analysis.cycles).toEqual([]);
    expect(analysis.filesInCycles).toBe(0);
  });

  it('fast and deep modes agree on the cycle', () => {
    const fast = detectCycles(cyclesFixture, { resolve: false });
    const deep = detectCycles(cyclesFixture, { resolve: true });
    expect(deep.filesInCycles).toBe(fast.filesInCycles);
    expect(deep.cycles[0]!.files).toEqual(fast.cycles[0]!.files);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), cyclesFixture);
    expect(detectCycles(relative).cycles).toHaveLength(1);
  });

  it('reports a file that imports itself as a single-file cycle', () => {
    const analysis = detectCycles(selfImportFixture);
    expect(analysis.filesInCycles).toBe(1);
    expect(analysis.cycles).toEqual([{ files: ['node.ts'], path: ['node.ts', 'node.ts'] }]);
  });

  it('reports a real import loop for a group, not its files in alphabetical order', () => {
    const [cycle] = detectCycles(hubFixture).cycles;
    expect(cycle!.files).toEqual([
      'artifacts/code/server.ts',
      'artifacts/sheet/server.ts',
      'artifacts/text/server.ts',
      'lib/server.ts',
    ]);
    expect(cycle!.path).toEqual([
      'artifacts/code/server.ts',
      'lib/server.ts',
      'artifacts/code/server.ts',
    ]);
    const { adjacency } = buildImportGraph(hubFixture);
    for (let step = 0; step < cycle!.path.length - 1; step++) {
      expect(adjacency.get(cycle!.path[step]!)).toContain(cycle!.path[step + 1]);
    }
  });

  it('shows the loop through the other files when the first file of a group also imports itself', () => {
    expect(detectCycles(selfMemberFixture).cycles).toEqual([
      { files: ['a.ts', 'b.ts'], path: ['a.ts', 'b.ts', 'a.ts'] },
      { files: ['a.ts'], path: ['a.ts', 'a.ts'] },
    ]);
  });
});
