import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import ignore from 'ignore';

type Matcher = ReturnType<typeof ignore>;

const DEFAULT_IGNORES = ['node_modules', 'dist', 'build', 'coverage', '.next', '.git'];

export type IgnoreFilter = (relativePath: string, isDirectory: boolean) => boolean;

function addFile(matcher: Matcher, file: string): void {
  if (!existsSync(file)) return;
  try {
    matcher.add(readFileSync(file, 'utf8'));
  } catch {
    /* v8 ignore next -- an unreadable ignore file just contributes nothing */
  }
}

/**
 * Matches git's own view of what is ignored, using the repo-scoped ignore sources:
 * the default noise dirs, the root `.gitignore`, every nested `.gitignore`, and
 * `.git/info/exclude`. The machine-global excludesFile is deliberately not read, so the
 * same repo scans identically across machines (benchmark reproducibility).
 */
export function createIgnoreFilter(root: string): IgnoreFilter {
  const base = ignore().add(DEFAULT_IGNORES);
  addFile(base, path.join(root, '.gitignore'));
  addFile(base, path.join(root, '.git', 'info', 'exclude'));

  const nestedByDir = new Map<string, Matcher | null>();
  const nestedMatcher = (relDir: string): Matcher | null => {
    const cached = nestedByDir.get(relDir);
    if (cached !== undefined) return cached;
    const file = path.join(root, relDir, '.gitignore');
    let matcher: Matcher | null = null;
    if (existsSync(file)) {
      matcher = ignore();
      addFile(matcher, file);
    }
    nestedByDir.set(relDir, matcher);
    return matcher;
  };

  return (relativePath: string, isDirectory: boolean): boolean => {
    if (relativePath === '') return false;
    const posix = relativePath.split(path.sep).join('/');
    const target = (rel: string): string => (isDirectory ? `${rel}/` : rel);
    if (base.ignores(target(posix))) return true;

    const parts = posix.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      const matcher = nestedMatcher(parts.slice(0, depth).join('/'));
      if (matcher?.ignores(target(parts.slice(depth).join('/')))) return true;
    }
    return false;
  };
}
