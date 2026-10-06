import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const isStrictlyInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const realFolder = (folder: string): string => {
  let existing = folder;
  while (!existsSync(existing)) existing = path.dirname(existing);
  return path.join(realpathSync(existing), path.relative(existing, folder));
};

const throughParentFolders = (target: string): string =>
  path.join(realFolder(path.dirname(target)), path.basename(target));

export const isSymlink = (target: string): boolean =>
  existsSync(target) && lstatSync(target).isSymbolicLink();

/** The absolute path of `target` if it lies strictly inside `root`, symlinks resolved; otherwise null. */
export function ownedPath(root: string, target: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, target);
  if (!isStrictlyInside(resolvedRoot, resolved) || isSymlink(resolvedRoot)) return null;
  return isStrictlyInside(realFolder(resolvedRoot), throughParentFolders(resolved))
    ? resolved
    : null;
}

/** True when `file`, symlinks resolved, stays inside the folder that holds it. */
export function staysInsideItsFolder(file: string): boolean {
  const resolved = path.resolve(file);
  const real = existsSync(resolved) ? realpathSync(resolved) : throughParentFolders(resolved);
  return isStrictlyInside(realpathSync(path.dirname(resolved)), real);
}

/** Refuses an output folder that is a symlink, or that a symlink inside `cwd` redirects outside it. */
export function assertRealDirectory(dir: string, cwd = process.cwd()): void {
  const lexicallyInside = isStrictlyInside(path.resolve(cwd), path.resolve(dir));
  if (isSymlink(dir) || (lexicallyInside && ownedPath(cwd, dir) === null)) {
    throw new Error(
      `${dir} is, or sits inside, a symbolic link that points elsewhere. archprint refuses to write or delete through it; use a real folder.`,
    );
  }
}

/** Deletes `file` when it is a regular file strictly inside `root`, leaving anything else in place. */
export function removeOwnedFile(root: string, file: string): boolean {
  const target = ownedPath(root, file);
  if (target === null || !existsSync(target) || !lstatSync(target).isFile()) return false;
  rmSync(target);
  return true;
}

/** Writes `content` to `file` as a regular file strictly inside `root`, replacing a symlink rather than following it. */
export function writeOwnedFile(root: string, file: string, content: string): void {
  const target = ownedPath(root, file);
  if (target === null) {
    throw new Error(`${file} is outside ${root}; archprint refuses to write it.`);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  if (isSymlink(target)) rmSync(target);
  writeFileSync(target, content);
}
