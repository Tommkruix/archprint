import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import type { WalkedFile } from '../scanner/file-walker.js';
import { REQUEST_ENTRY_ROLES } from './pattern-detector.js';

const ENTRY_FILENAME =
  /(^|\/)(page|layout|loading|error|not-found|template|default|route|middleware|instrumentation|global-error|_app|_document|index)\.(ts|tsx)$/;
const CONFIG_FILE = /\.config\.(ts|tsx|js|mjs|cjs)$/;

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
  fileCount: number;
  orphans: string[];
}

export interface OrphanDetectorOptions {
  resolve?: boolean;
  graph?: ImportGraph;
}

export function detectOrphans(appDir: string, options: OrphanDetectorOptions = {}): OrphanAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const inDegree = new Map<string, number>(files.map((file) => [file.relativePath, 0]));
  for (const targets of adjacency.values()) {
    for (const target of targets) inDegree.set(target, inDegree.get(target)! + 1);
  }

  const orphans = files
    .filter((file) => (inDegree.get(file.relativePath) ?? 0) === 0 && !isEntry(file))
    .map((file) => file.relativePath)
    .sort();

  return { appDir: root, fileCount: files.length, orphans };
}
