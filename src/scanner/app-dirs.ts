import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { listSourceFiles } from './file-walker.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.git']);

/** Directories under `root` that hold a tsconfig.json (the candidate app / package roots). */
function findTsconfigDirs(root: string): string[] {
  const dirs: string[] = [];
  const walk = (dir: string): void => {
    if (existsSync(path.join(dir, 'tsconfig.json'))) dirs.push(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      /* v8 ignore next -- defensive: unreadable directory */
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        walk(path.join(dir, entry.name));
      }
    }
  };
  walk(root);
  return dirs;
}

/** The deepest tsconfig dir that contains `file`: the app a file belongs to. */
function deepestOwner(dirs: readonly string[], file: string): string | null {
  let best: string | null = null;
  for (const dir of dirs) {
    if (
      (file === dir || file.startsWith(dir + path.sep)) &&
      (best === null || dir.length > best.length)
    ) {
      best = dir;
    }
  }
  return best;
}

/**
 * Discover the app directories to scan under `root`: the tsconfig dirs that own at least `minFiles` source
 * files (their own subtree, excluding any nested tsconfig dir). A monorepo yields one entry per app/package;
 * a single app yields just its own root. Falls back to any tsconfig dir with source when none clears the
 * threshold (small repos), and returns nothing when there is no tsconfig at all (Archprint needs one to
 * resolve aliases).
 */
export function discoverAppDirs(root: string, minFiles = 25): string[] {
  const absRoot = path.resolve(root);
  const tsconfigDirs = findTsconfigDirs(absRoot);
  if (tsconfigDirs.length === 0) return [];

  const ownCount = new Map<string, number>(tsconfigDirs.map((dir) => [dir, 0]));
  for (const file of listSourceFiles(absRoot)) {
    const owner = deepestOwner(tsconfigDirs, file);
    if (owner !== null) ownCount.set(owner, (ownCount.get(owner) ?? 0) + 1);
  }

  const sizable = tsconfigDirs.filter((dir) => (ownCount.get(dir) ?? 0) >= minFiles);
  const chosen =
    sizable.length > 0 ? sizable : tsconfigDirs.filter((dir) => (ownCount.get(dir) ?? 0) > 0);
  return chosen.sort();
}
