import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { directoriesUnder } from './directory-walk.js';
import { listSourceFiles } from './file-walker.js';
import { hasProjectConfig, projectConfigPaths } from './workspace-resolver.js';

const hasStandardConfig = (dir: string): boolean =>
  existsSync(path.join(dir, 'tsconfig.json')) || existsSync(path.join(dir, 'tsconfig.base.json'));

/**
 * Every directory under `root` with a tsconfig.json or tsconfig.base.json, the root included, skipping ignored ones,
 * and each one whose files a `tsconfig.*.json` beside it compiles, unless a directory with one of those two sits above it:
 * TypeScript's lookup would find that config, not the variants.
 */
export function findTsconfigDirs(root: string): string[] {
  const configured = directoriesUnder(
    root,
    (dir) => hasStandardConfig(dir) || projectConfigPaths(dir).length > 0,
  );
  const standard = configured.filter(hasStandardConfig);
  const isUnderStandard = (dir: string): boolean =>
    standard.some((owner) => dir.startsWith(owner + path.sep));
  return configured.filter(
    (dir) => hasStandardConfig(dir) || (!isUnderStandard(dir) && hasProjectConfig(dir)),
  );
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
  const withFiles = tsconfigDirs.filter((dir) => (ownCount.get(dir) ?? 0) > 0);
  const chosen = sizable.length > 0 ? sizable : withFiles.length > 0 ? withFiles : tsconfigDirs;
  return chosen.sort();
}
