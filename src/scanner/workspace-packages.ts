import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

/** Map workspace-package name to its directory, from `package.json` workspaces or pnpm-workspace.yaml. */
export function buildWorkspacePackageMap(rootDir: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const packageDir of expandGlobs(rootDir, readWorkspaceGlobs(rootDir))) {
    const packageJsonPath = path.join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) continue;
    try {
      const name: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf-8')).name;
      if (typeof name === 'string' && name.length > 0) map[name] = packageDir;
    } catch {
      // unreadable/invalid package.json; skip
    }
  }
  return map;
}

/**
 * Walk up from a directory to the monorepo root (the nearest ancestor declaring workspaces).
 * Returns the start directory unchanged if no workspace root is found.
 */
export function findWorkspaceRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const packageJsonPath = path.join(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        if (JSON.parse(readFileSync(packageJsonPath, 'utf-8')).workspaces !== undefined) return dir;
      } catch {
        // fall through
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

function readWorkspaceGlobs(rootDir: string): string[] {
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const workspaces: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf-8')).workspaces;
      const globs = Array.isArray(workspaces)
        ? workspaces
        : Array.isArray((workspaces as { packages?: unknown })?.packages)
          ? (workspaces as { packages: string[] }).packages
          : [];
      if (globs.length > 0) return globs as string[];
    } catch {
      // fall through to pnpm
    }
  }
  // pnpm-workspace.yaml: minimal parse of the top-level `packages:` list.
  const pnpmPath = path.join(rootDir, 'pnpm-workspace.yaml');
  if (existsSync(pnpmPath)) {
    const globs: string[] = [];
    let inPackages = false;
    for (const line of readFileSync(pnpmPath, 'utf-8').split('\n')) {
      if (/^packages:/.test(line)) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        const captured = line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*$/)?.[1];
        if (captured !== undefined) globs.push(captured.trim());
        else if (/^\S/.test(line)) break; // next top-level key ends the list
      }
    }
    return globs;
  }
  return [];
}

function expandGlobs(rootDir: string, globs: string[]): string[] {
  const dirs: string[] = [];
  const oneLevel = (prefix: string): void => {
    const base = path.join(rootDir, prefix);
    if (!existsSync(base)) return;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(base, entry.name));
    }
  };
  for (const glob of globs) {
    if (glob.startsWith('!')) continue; // negations ignored (kept simple)
    if (glob.endsWith('/*')) oneLevel(glob.slice(0, -2));
    else if (glob.endsWith('/**')) oneLevel(glob.slice(0, -3));
    else dirs.push(path.join(rootDir, glob)); // explicit path
  }
  return dirs;
}
