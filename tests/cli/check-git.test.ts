import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addedLines, changedFiles, renamedPaths } from '../../src/cli/check-git.js';
import { gitEnv } from '../../src/cli/git-env.js';
import { writeTree } from '../integration/layer-app.js';

describe('changedFiles', () => {
  let repo: string;
  let base: string;
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, env: gitEnv(), encoding: 'utf8' });

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-changed-')));
    writeTree(repo, {
      'a b/AGENTS.md': 'One.\n',
      'ünï/CLAUDE.md': 'One.\n',
      'old.md': 'Moved content that stays the same.\n',
      'gone.md': 'Removed.\n',
    });
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.com');
    git('add', '-A');
    git('commit', '-qm', 'base');
    base = git('rev-parse', 'HEAD').trim();
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('lists changed, renamed and untracked files with their base path, unquoted, and not deleted ones', () => {
    writeTree(repo, {
      'a b/AGENTS.md': 'One. Two.\n',
      'ünï/CLAUDE.md': 'One. Two.\n',
      'x/AGENTS.md': 'New.\n',
    });
    git('mv', 'old.md', 'new.md');
    unlinkSync(path.join(repo, 'gone.md'));
    const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : 1);
    expect(changedFiles(repo, base).sort(byPath)).toEqual(
      [
        { path: 'a b/AGENTS.md', basePath: 'a b/AGENTS.md' },
        { path: 'new.md', basePath: 'old.md' },
        { path: 'x/AGENTS.md', basePath: null },
        { path: 'ünï/CLAUDE.md', basePath: 'ünï/CLAUDE.md' },
      ].sort(byPath),
    );
    expect(renamedPaths(repo, base)).toEqual(new Map([['old.md', 'new.md']]));
  });

  it('gives the lines each file gained: one-line and multi-line hunks, paths with spaces or non-ASCII, none for a pure rename, scoped to a folder', () => {
    writeTree(repo, {
      'a b/AGENTS.md': 'Zero.\nOne.\nTwo.\nThree.\n',
      'ünï/CLAUDE.md': 'Changed.\n',
    });
    git('mv', 'old.md', 'new.md');
    expect(addedLines(repo, base, '')).toEqual(
      new Map([
        ['a b/AGENTS.md', new Set([1, 3, 4])],
        ['ünï/CLAUDE.md', new Set([1])],
      ]),
    );
    expect(addedLines(repo, base, 'ünï')).toEqual(new Map([['ünï/CLAUDE.md', new Set([1])]]));
  });
});
