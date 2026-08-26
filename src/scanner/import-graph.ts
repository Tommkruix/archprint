import { existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from './file-walker.js';
import { buildWorkspaceMap } from './workspace-resolver.js';

interface AliasEntry {
  prefix: string;
  dir: string;
}

const buildAliasEntries = (appDir: string): AliasEntry[] =>
  Object.entries(buildWorkspaceMap(appDir)).map(([key, value]) => ({
    prefix: key.replace(/\/?\*$/, ''),
    dir: path.resolve(appDir, String(value).replace(/\/?\*$/, '')),
  }));

const FILE_CANDIDATES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** Resolve a value import to the first-party source file it targets (relative path or tsconfig alias), fast
 *  (no type checker). Returns null for externals, other packages, and unresolved specifiers. */
function resolveImportFile(
  specifier: string,
  fromAbsPath: string,
  aliases: readonly AliasEntry[],
): string | null {
  let base: string | null = null;
  if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromAbsPath), specifier);
  } else {
    for (const { prefix, dir } of aliases) {
      if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
        base = path.resolve(dir, specifier.slice(prefix.length).replace(/^\//, ''));
        break;
      }
    }
  }
  if (base === null) return null;
  for (const suffix of FILE_CANDIDATES) {
    const candidate = base + suffix;
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

export interface ImportGraph {
  root: string;
  /** Non-test source files in the app. */
  files: WalkedFile[];
  /** repo-relative path -> the repo-relative first-party files it imports as values. */
  adjacency: Map<string, string[]>;
}

/**
 * Build the first-party value-import graph for an app-dir. Deep mode uses the type-resolved leaves; fast mode
 * resolves each specifier to a file syntactically. Shared by the cycle and orphan detectors so the graph is
 * built one way. `appDir` is normalized to an absolute path.
 */
export function buildImportGraph(appDir: string, options: { resolve?: boolean } = {}): ImportGraph {
  const resolve = options.resolve ?? false;
  const root = path.resolve(appDir);
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const relByAbs = new Map<string, string>(
    files.map((file) => [file.absolutePath, file.relativePath]),
  );
  const aliases = buildAliasEntries(root);
  const analyze = createImportAnalyzer(root, { resolve });

  const adjacency = new Map<string, string[]>();
  for (const file of files) {
    let imports: ResolvedImport[];
    try {
      imports = analyze(file.absolutePath);
    } catch {
      imports = [];
    }
    const targets = new Set<string>();
    for (const imp of imports) {
      if (!imp.hasValueBinding) continue;
      if (resolve) {
        for (const leaf of imp.valueLeafPaths) {
          const rel = relByAbs.get(leaf);
          if (rel !== undefined) targets.add(rel);
        }
      } else {
        const abs = resolveImportFile(imp.specifier, file.absolutePath, aliases);
        const rel = abs === null ? undefined : relByAbs.get(abs);
        if (rel !== undefined) targets.add(rel);
      }
    }
    adjacency.set(file.relativePath, [...targets]);
  }

  return { root, files, adjacency };
}
