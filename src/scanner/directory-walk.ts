import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { createIgnoreFilter } from './ignore-filter.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.git']);

/** Every directory under `root` that `wanted` accepts, the root included, skipping ignored, hidden and build ones. */
export function directoriesUnder(root: string, wanted: (dir: string) => boolean): string[] {
  const dirs: string[] = [];
  const isIgnored = createIgnoreFilter(root);
  const walk = (dir: string): void => {
    if (wanted(dir)) dirs.push(dir);
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
