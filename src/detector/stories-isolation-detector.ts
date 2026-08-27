import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const STORY = /\.stories\.(ts|tsx)$/;

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

export function detectStoriesIsolation(
  appDir: string,
  options: StoriesIsolationOptions = {},
): StoriesIsolationAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const stories = new Set(
    files.filter((file) => STORY.test(file.relativePath)).map((file) => file.relativePath),
  );
  const importerOf = new Map<string, string>();
  for (const [file, targets] of adjacency) {
    if (STORY.test(file)) continue;
    for (const target of targets) {
      if (stories.has(target) && !importerOf.has(target)) importerOf.set(target, file);
    }
  }

  const violations: StoryImportViolation[] = [...importerOf.entries()]
    .map(([file, importer]) => ({ file, importer }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return {
    appDir: root,
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
