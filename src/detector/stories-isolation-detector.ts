import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

export const STORY = /\.stories\.(ts|tsx)$/;

export interface StoryImportViolation {
  file: string;
  importer: string;
}

export interface StoriesIsolationAnalysis {
  appDir: string;
  storyCount: number;
  offenderCount: number;
  gate: GateResult;
  violations: StoryImportViolation[];
}

export interface StoriesIsolationOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

const storiesOf = (graph: ImportGraph): Set<string> =>
  new Set(
    graph.files.filter((file) => STORY.test(file.relativePath)).map((file) => file.relativePath),
  );

/** Every import of a story by a file that is not one, in graph order. */
function storyEdges(graph: ImportGraph, stories: ReadonlySet<string>): StoryImportViolation[] {
  const edges: StoryImportViolation[] = [];
  for (const [file, targets] of graph.adjacency) {
    if (STORY.test(file)) continue;
    for (const target of targets) {
      if (stories.has(target)) edges.push({ file: target, importer: file });
    }
  }
  return edges;
}

/** Every import of a story, the way the stories rule enforces: one entry per importing file and story. */
export function storyImports(appDir: string): StoryImportViolation[] {
  const graph = buildImportGraph(appDir, { resolve: false });
  return storyEdges(graph, storiesOf(graph));
}

export function detectStoriesIsolation(
  appDir: string,
  options: StoriesIsolationOptions = {},
): StoriesIsolationAnalysis {
  const graph = options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });
  const stories = storiesOf(graph);
  const importerOf = new Map<string, string>();
  for (const { file, importer } of storyEdges(graph, stories)) {
    if (!importerOf.has(file)) importerOf.set(file, importer);
  }

  const violations: StoryImportViolation[] = [...importerOf.entries()]
    .map(([file, importer]) => ({ file, importer }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return {
    appDir: graph.root,
    storyCount: stories.size,
    offenderCount: violations.length,
    gate: evaluateGate({
      roleFileCount: stories.size,
      violatingFileCount: violations.length,
      roleConfidence: 1,
    }),
    violations,
  };
}
