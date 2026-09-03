import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { listSourceFiles } from './file-walker.js';
import { createIgnoreFilter } from './ignore-filter.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.git']);

function findTsconfigDirs(root: string): string[] {
  const dirs: string[] = [];
  const isIgnored = createIgnoreFilter(root);
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
      const full = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !SKIP_DIRS.has(entry.name) &&
        !entry.name.startsWith('.') &&
        !isIgnored(path.relative(root, full), true)
      ) {
        walk(full);
      }
    }
  };
  walk(root);
  return dirs;
}

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
