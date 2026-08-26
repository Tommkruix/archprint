import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import type { WalkedFile } from '../scanner/file-walker.js';
import { REQUEST_ENTRY_ROLES } from './pattern-detector.js';

/** Framework file-convention entries: loaded by the framework/build, not imported by first-party code. */
const ENTRY_FILENAME =
  /(^|\/)(page|layout|loading|error|not-found|template|default|route|middleware|instrumentation|global-error|_app|_document|index)\.(ts|tsx)$/;
/** Config files (next.config, vitest.config, etc.) are loaded by tooling, never imported by source. */
const CONFIG_FILE = /\.config\.(ts|tsx|js|mjs|cjs)$/;

/** A file the framework or tooling loads directly, so a zero in-degree is expected, not a smell. */
function isEntry(file: WalkedFile): boolean {
  return (
    REQUEST_ENTRY_ROLES.includes(file.role) ||
    file.role === 'ROUTE_ENTRY' ||
    ENTRY_FILENAME.test(file.relativePath) ||
    CONFIG_FILE.test(file.relativePath)
  );
}

export interface OrphanAnalysis {
  appDir: string;
  /** Non-test source files considered. */
  fileCount: number;
  /** repo-relative files that nothing imports and that are not framework/tooling entries, sorted. */
  orphans: string[];
}

export interface OrphanDetectorOptions {
  /** Resolve the graph with the type checker (deep). Default false: fast file resolution. */
  resolve?: boolean;
  /** A prebuilt graph to analyze, so a caller running several detectors builds the graph once. */
  graph?: ImportGraph;
}

/**
 * Find orphan modules: first-party source files that no other file imports and that are not framework or
 * tooling entry points (routes, pages, layouts, middleware, config). These are candidates for dead code.
 * Reported as an informational SUGGEST only, never enforced: dynamic/string-based loading and framework
 * magic can make a live file look unreferenced, so a human should confirm before deleting.
 */
export function detectOrphans(appDir: string, options: OrphanDetectorOptions = {}): OrphanAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const inDegree = new Map<string, number>(files.map((file) => [file.relativePath, 0]));
  // Every adjacency target is a walked file, so it is always already a key in inDegree.
  for (const targets of adjacency.values()) {
    for (const target of targets) inDegree.set(target, inDegree.get(target)! + 1);
  }

  const orphans = files
    .filter((file) => (inDegree.get(file.relativePath) ?? 0) === 0 && !isEntry(file))
    .map((file) => file.relativePath)
    .sort();

  return { appDir: root, fileCount: files.length, orphans };
}
