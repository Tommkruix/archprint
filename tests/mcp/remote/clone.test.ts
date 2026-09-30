import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { withClonedRepo } from '../../../src/mcp/remote/clone.js';
import type { RepoSpec } from '../../../src/mcp/remote/repo-url.js';

const sources: string[] = [];
afterEach(() => {
  while (sources.length > 0) rmSync(sources.pop()!, { recursive: true, force: true });
});

function makeRepo(withFeatureBranch = false): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'archprint-src-'));
  sources.push(dir);
  const git = (...args: string[]): void =>
    void execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'README.md'), '# hello\n');
  git('add', '.');
  git('commit', '-m', 'init');
  if (withFeatureBranch) {
    git('checkout', '-b', 'feature');
    writeFileSync(path.join(dir, 'FEATURE.md'), 'x\n');
    git('add', '.');
    git('commit', '-m', 'feat');
    git('checkout', 'main');
  }
  return pathToFileURL(dir).href;
}

const spec = (cloneUrl: string): RepoSpec => ({ cloneUrl, host: 'localhost', slug: 'test/repo' });
const countTempClones = (): number =>
  readdirSync(tmpdir()).filter((name) => name.startsWith('archprint-remote-')).length;

describe('withClonedRepo', () => {
  it('clones the repo, exposes the working tree, and removes the temp dir afterward', async () => {
    let seen: string | undefined;
    const files = await withClonedRepo(spec(makeRepo()), undefined, {}, (dir) => {
      seen = dir;
      return readdirSync(dir);
    });
    expect(files).toContain('README.md');
    expect(existsSync(seen!)).toBe(false);
  });

  it('checks out a specific ref', async () => {
    const files = await withClonedRepo(spec(makeRepo(true)), 'feature', {}, (dir) =>
      readdirSync(dir),
    );
    expect(files).toContain('FEATURE.md');
  });

  it('rejects a failed clone and leaves no temp dir behind', async () => {
    const before = countTempClones();
    await expect(
      withClonedRepo(spec('file:///archprint-does-not-exist-xyz'), undefined, {}, () => 1),
    ).rejects.toThrow(/git clone failed/);
    expect(countTempClones()).toBe(before);
  });

  it('rejects a repo that exceeds the size limit and cleans up', async () => {
    const before = countTempClones();
    await expect(
      withClonedRepo(spec(makeRepo()), undefined, { maxBytes: 5 }, () => 1),
    ).rejects.toThrow(/exceeds/);
    expect(countTempClones()).toBe(before);
  });

  it('reports a clone that exceeds its timeout', async () => {
    await expect(
      withClonedRepo(spec(makeRepo()), undefined, { timeoutMs: 1 }, () => 1),
    ).rejects.toThrow(/timed out/);
  });

  it('reports when git cannot be run', async () => {
    const previous = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(
        withClonedRepo(spec('file:///whatever'), undefined, {}, () => 1),
      ).rejects.toThrow(/Could not run git/);
    } finally {
      process.env.PATH = previous;
    }
  });

  it('ignores a malicious parent git config that would redirect the clone', async () => {
    const url = makeRepo();
    const previous = process.env.GIT_CONFIG_PARAMETERS;
    process.env.GIT_CONFIG_PARAMETERS = "'url.file:///archprint-does-not-exist/.insteadOf=file://'";
    try {
      const files = await withClonedRepo(spec(url), undefined, {}, (dir) => readdirSync(dir));
      expect(files).toContain('README.md');
    } finally {
      if (previous === undefined) delete process.env.GIT_CONFIG_PARAMETERS;
      else process.env.GIT_CONFIG_PARAMETERS = previous;
    }
  });
});
