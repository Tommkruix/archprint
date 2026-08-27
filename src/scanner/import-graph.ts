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
  /* v8 ignore next -- a first-party-looking specifier that resolves to no .ts file (missing/non-ts target) */
  return null;
}

export interface ImportGraph {
  root: string;
  files: WalkedFile[];
  adjacency: Map<string, string[]>;
}

export interface ImportGraphOptions {
  resolve?: boolean;
  includeTests?: boolean;
}

export function buildImportGraph(appDir: string, options: ImportGraphOptions = {}): ImportGraph {
  const resolve = options.resolve ?? false;
  const root = path.resolve(appDir);
  const files = options.includeTests
    ? walkRepo(root)
    : walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
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
      /* v8 ignore next -- defensive: analyze throws only on an unreadable/malformed source file */
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

/**
 * Tarjan strongly-connected components, iterative so it stays safe on large, deep graphs. Returns one array
 * of node ids per component; a component of size > 1 (or a single self-looping node) is a cycle.
 */
export function stronglyConnectedComponents(
  nodes: readonly string[],
  adjacency: Map<string, string[]>,
): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const componentStack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const start of nodes) {
    if (index.has(start)) continue;
    const work: { node: string; next: number }[] = [{ node: start, next: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const node = frame.node;
      if (frame.next === 0) {
        index.set(node, counter);
        lowLink.set(node, counter);
        counter += 1;
        componentStack.push(node);
        onStack.add(node);
      }
      const neighbours = adjacency.get(node) ?? [];
      if (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next]!;
        frame.next += 1;
        if (!index.has(neighbour)) {
          work.push({ node: neighbour, next: 0 });
        } else if (onStack.has(neighbour)) {
          lowLink.set(node, Math.min(lowLink.get(node)!, index.get(neighbour)!));
        }
      } else {
        if (lowLink.get(node) === index.get(node)) {
          const component: string[] = [];
          let popped: string;
          do {
            popped = componentStack.pop()!;
            onStack.delete(popped);
            component.push(popped);
          } while (popped !== node);
          result.push(component);
        }
        work.pop();
        const parent = work[work.length - 1]?.node;
        if (parent !== undefined) {
          lowLink.set(parent, Math.min(lowLink.get(parent)!, lowLink.get(node)!));
        }
      }
    }
  }
  return result;
}
