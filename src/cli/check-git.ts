import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { gitEnv } from './git-env.js';

export class CheckSetupError extends Error {}

const git = (cwd: string, args: readonly string[], env = gitEnv()): string => {
  try {
    return execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new CheckSetupError(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
};

export const repoRoot = (cwd: string): string => git(cwd, ['rev-parse', '--show-toplevel']).trim();

export function defaultBase(root: string): string {
  try {
    return git(root, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).trim();
  } catch {
    throw new CheckSetupError(
      'no --base given and origin/HEAD is not set; pass the branch or commit to compare against, for example --base origin/main',
    );
  }
}

export function mergeBase(root: string, base: string): string {
  if (base.startsWith('-')) {
    throw new CheckSetupError(`"${base}" is not a branch or commit name.`);
  }
  try {
    return git(root, ['merge-base', 'HEAD', base]).trim();
  } catch {
    throw new CheckSetupError(
      `cannot find a common ancestor of HEAD and ${base}. In CI, fetch the full history (actions/checkout with fetch-depth: 0).`,
    );
  }
}

export function fileAtCommit(root: string, commit: string, relativePath: string): string | null {
  try {
    return git(root, ['show', `${commit}:${relativePath}`]);
  } catch {
    return null;
  }
}

export function renamedPaths(root: string, commit: string): Map<string, string> {
  const renames = new Map<string, string>();
  const output = git(root, ['diff', '--name-status', '-M', '-z', commit]);
  const fields = output.split('\u0000');
  for (let index = 0; index < fields.length; index++) {
    const status = fields[index]!;
    if (status.startsWith('R')) {
      renames.set(fields[index + 1]!, fields[index + 2]!);
      index += 2;
    } else if (status !== '') {
      index += 1;
    }
  }
  return renames;
}

export interface BaseTree {
  root: string;
  dispose: () => void;
}

function linkNodeModules(
  headRoot: string,
  baseRoot: string,
  relativeDirs: readonly string[],
): void {
  for (const relative of new Set(relativeDirs)) {
    const source = path.join(headRoot, relative, 'node_modules');
    const target = path.join(baseRoot, relative, 'node_modules');
    if (existsSync(source) && !existsSync(target) && existsSync(path.dirname(target))) {
      symlinkSync(source, target, 'dir');
    }
  }
}

export function checkoutBase(root: string, commit: string, appRelative: string): BaseTree {
  const parent = mkdtempSync(path.join(tmpdir(), 'archprint-check-'));
  const snapshot = path.join(parent, 'base');
  const dispose = (): void => rmSync(parent, { recursive: true, force: true });
  const env = { ...gitEnv(), GIT_INDEX_FILE: path.join(parent, 'index') };
  try {
    git(root, ['read-tree', commit], env);
    git(root, ['checkout-index', '--all', `--prefix=${snapshot}/`], env);
  } catch (error) {
    dispose();
    throw error;
  }
  linkNodeModules(root, snapshot, ['', appRelative]);
  return { root: snapshot, dispose };
}
