import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import ignore from 'ignore';

const DEFAULT_IGNORES = ['node_modules', 'dist', 'build', 'coverage', '.next', '.git'];

export type IgnoreFilter = (relativePath: string, isDirectory: boolean) => boolean;

export function createIgnoreFilter(root: string): IgnoreFilter {
  const matcher = ignore().add(DEFAULT_IGNORES);
  const gitignore = path.join(root, '.gitignore');
  if (existsSync(gitignore)) {
    try {
      matcher.add(readFileSync(gitignore, 'utf8'));
    } catch {
      /* v8 ignore next -- unreadable .gitignore contributes only the default ignores */
    }
  }
  return (relativePath: string, isDirectory: boolean): boolean => {
    if (relativePath === '') return false;
    const posix = relativePath.split(path.sep).join('/');
    return matcher.ignores(isDirectory ? `${posix}/` : posix);
  };
}
