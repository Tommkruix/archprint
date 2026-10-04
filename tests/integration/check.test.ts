import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/cli/program.js';
import { runCheck } from '../../src/cli/check.js';
import { checkoutBase, renamedPaths } from '../../src/cli/check-git.js';
import { gitEnv } from '../../src/cli/git-env.js';
import { callTool } from '../../src/mcp/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const autoFixture = path.join(here, '..', 'fixtures', 'cli-auto');
const app = 'apps/web';
const directDbRoute =
  "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();\n";

const run = (args: string[]): Promise<unknown> =>
  buildProgram('9.9.9').parseAsync(args, { from: 'user' });

const REAL_GIT_TIMEOUT_MS = 120_000;

describe('archprint check against real git history', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  let cwd: string;
  let repo: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const output = (): string =>
    logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: repo,
      env: gitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const commitAll = (message: string): void => {
    git('add', '-A');
    git('commit', '-qm', message);
  };
  const write = (relative: string, content: string): void => {
    const file = path.join(repo, app, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const adoptWithOneException = async (): Promise<void> => {
    for (let index = 0; index < 40; index++) {
      write(
        `app/api/extra${index}/route.ts`,
        "export async function GET() { return new Response('ok'); }\n",
      );
    }
    write('app/api/legacy/route.ts', directDbRoute);
    await run(['init', app, '--force']);
    const rules = JSON.parse(readFileSync(path.join(repo, '.archprint', 'rules.json'), 'utf8'));
    const ap001 = rules.rules.find((rule: { id: string }) => rule.id === 'AP-001');
    expect(ap001.evidence.conforming).toBe(ap001.evidence.total - 1);
  };

  beforeEach(async () => {
    cwd = process.cwd();
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-check-')));
    cpSync(autoFixture, path.join(repo, app), { recursive: true });
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.com');
    process.chdir(repo);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(['init', app]);
    commitAll('adopt archprint');
    git('checkout', '-q', '-b', 'feature');
    logSpy.mockClear();
  }, REAL_GIT_TIMEOUT_MS);
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
    process.exitCode = 0;
    delete process.env.GITHUB_STEP_SUMMARY;
  });

  it('reports a violation in uncommitted edits through the MCP check tool, with the app it is in', () => {
    write('app/api/orders/route.ts', directDbRoute);
    const response = callTool('archprint_check', { path: repo, base: 'main' });
    expect(response.isError).toBeFalsy();
    expect(JSON.parse(response.content[0]!.text)).toMatchObject({
      status: 'checked',
      app: app,
      introduced: [{ rule: 'AP-001', file: 'app/api/orders/route.ts', line: 1 }],
      fixed: [],
    });
  });

  it('returns a setup problem from the MCP check tool as an error response', () => {
    const response = callTool('archprint_check', { path: repo, base: 'no-such-branch' });
    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toMatch(/no-such-branch/);
  });

  it('checks the repository it runs in when a git hook points GIT_DIR at another one', async () => {
    const other = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-other-')));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: other, env: gitEnv() });
      write('app/api/orders/route.ts', directDbRoute);
      commitAll('query the database in a route');
      process.env.GIT_DIR = path.join(other, '.git');
      try {
        await run(['check', '--base', 'main']);
      } finally {
        delete process.env.GIT_DIR;
      }
      expect(output()).toContain('app/api/orders/route.ts:1  AP-001 (@prisma/client)');
      expect(readdirSync(path.join(other, '.git', 'refs', 'heads'))).toEqual([]);
      expect(existsSync(path.join(other, '.git', 'worktrees'))).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('records the adopted rules with the mode they were generated in', () => {
    const rules = JSON.parse(readFileSync(path.join(repo, '.archprint', 'rules.json'), 'utf8'));
    expect(rules.archprintVersion).toBe('9.9.9');
    const ap001 = rules.rules.find((rule: { id: string }) => rule.id === 'AP-001');
    expect(ap001).toMatchObject({ family: 'forbidden-imports', mode: 'deep' });
  });

  it('reports the one violation a change introduces, on its line, warning only by default', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    commitAll('query the database in a route');
    await run(['check', '--base', 'main']);
    expect(output()).toContain('app/api/orders/route.ts:1  AP-001 (@prisma/client)');
    expect(output()).toContain(
      'When this rule was adopted, 45 of 45 files it applies to followed it',
    );
    expect(process.exitCode).toBe(0);
    expect(existsSync(path.join(path.dirname(repo), 'base'))).toBe(false);
    expect(git('worktree', 'list').trim().split('\n')).toHaveLength(1);
  });

  it('fails with --fail-on new and writes repo-relative annotations and a step summary', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    commitAll('query the database in a route');
    const summary = path.join(repo, 'summary.md');
    process.env.GITHUB_STEP_SUMMARY = summary;
    await run(['check', '--base', 'main', '--format', 'github', '--fail-on', 'new']);
    expect(output()).toContain('::error file=apps/web/app/api/orders/route.ts,line=1,');
    expect(readFileSync(summary, 'utf8')).toContain('**1 new violation(s):**');
    expect(process.exitCode).toBe(1);
  });

  it('reports nothing new for a change that keeps every rule', async () => {
    write('lib/extra.ts', 'export const extra = 2;\n');
    commitAll('add a helper');
    await run(['check', '--base', 'main', '--format', 'json']);
    const json = JSON.parse(output());
    expect(json).toMatchObject({ status: 'checked', introduced: [], fixed: [] });
  });

  it('does not report an existing violation as new when its file is renamed', async () => {
    git('checkout', '-q', 'main');
    await adoptWithOneException();
    commitAll('adopt with one known exception');
    git('checkout', '-q', '-b', 'rename');
    git('mv', `${app}/app/api/legacy`, `${app}/app/api/archive`);
    commitAll('rename only');
    logSpy.mockClear();
    await run(['check', '--base', 'main']);
    expect(output()).toContain('No new violations.');
  });

  it('reports a violation the change removes as fixed', async () => {
    git('checkout', '-q', 'main');
    await adoptWithOneException();
    commitAll('adopt with one known exception');
    git('checkout', '-q', '-b', 'cleanup');
    git('rm', '-rq', `${app}/app/api/legacy`);
    commitAll('remove the legacy route');
    logSpy.mockClear();
    await run(['check', '--base', 'main']);
    expect(output()).toContain('No new violations.');
    expect(output()).toContain('Fixed: 1 violation(s) removed.');
  });

  it('lists rules adopted in the change without counting their existing violations', async () => {
    git('checkout', '-q', 'main');
    git('rm', '-rq', '.archprint');
    commitAll('drop the rules');
    git('checkout', '-q', '-b', 'readopt');
    await adoptWithOneException();
    commitAll('adopt again with one exception');
    logSpy.mockClear();
    await run(['check', '--base', 'main', '--fail-on', 'new']);
    expect(output()).toContain('Rule AP-001 was adopted in this change (1 existing violation(s)');
    expect(process.exitCode).toBe(0);
  });

  it('treats an unreadable rules file on the base as no adopted rules', () => {
    git('checkout', '-q', 'main');
    const rulesFile = path.join(repo, '.archprint', 'rules.json');
    const current = readFileSync(rulesFile, 'utf8');
    writeFileSync(rulesFile, '{"format":0}\n');
    commitAll('rules file from another version');
    git('checkout', '-q', '-b', 'regenerated');
    writeFileSync(rulesFile, current);
    commitAll('regenerate');
    const result = runCheck({ cwd: repo, out: '.archprint', base: 'main' });
    expect(result.status).toBe('checked');
    if (result.status !== 'checked') return;
    expect(result.adoptedInChange.map((entry) => entry.change)).toEqual(
      result.rules.map(() => 'new'),
    );
  });

  it('borrows the head node_modules for the base snapshot and removes it afterwards', () => {
    mkdirSync(path.join(repo, app, 'node_modules'), { recursive: true });
    const commit = git('rev-parse', 'main').trim();
    const base = checkoutBase(repo, commit, app);
    const link = path.join(base.root, app, 'node_modules');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(path.join(repo, app, 'node_modules'));
    base.dispose();
    expect(existsSync(base.root)).toBe(false);
  });

  it("reads the base commit without running the repository's git hooks or touching .git", async () => {
    const marker = path.join(repo, 'hook-ran');
    const hook = path.join(repo, '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    write('app/api/orders/route.ts', directDbRoute);
    commitAll('query the database in a route');
    await run(['check', '--base', 'main']);
    expect(output()).toContain('app/api/orders/route.ts:1  AP-001 (@prisma/client)');
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(path.join(repo, '.git', 'worktrees'))).toBe(false);
  });

  it('refuses a base that git would read as an option', () => {
    const response = callTool('archprint_check', { path: repo, base: '--all' });
    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toContain('"--all" is not a branch or commit name.');
  });

  it('leaves nothing behind when the base snapshot cannot be created', () => {
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('archprint-check-'));
    expect(() => checkoutBase(repo, 'no-such-commit', app)).toThrow(/git read-tree/);
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('archprint-check-'));
    expect(after.sort()).toEqual(before.sort());
  });

  it('refuses an app directory outside the repository, which a pull request could set', async () => {
    const config = path.join(repo, '.archprint', 'config.json');
    writeFileSync(
      config,
      JSON.stringify({ ...JSON.parse(readFileSync(config, 'utf8')), app: '../..' }),
    );
    await run(['check', '--base', 'main']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('outside the repository');
    expect(process.exitCode).toBe(2);
  });

  it('refuses an app directory that is a symlink pointing outside the repository', async () => {
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-outside-')));
    try {
      symlinkSync(outside, path.join(repo, 'escape'), 'dir');
      await run(['check', 'escape', '--base', 'main']);
      expect(errSpy.mock.calls.flat().join(' ')).toContain('outside the repository');
      expect(process.exitCode).toBe(2);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('exits 2 when the app directory does not exist or is a file', async () => {
    await run(['check', 'apps/missing', '--base', 'main']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('does not exist');
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
    await run(['check', `${app}/tsconfig.json`, '--base', 'main']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('is not a directory');
    expect(process.exitCode).toBe(2);
  });

  it('exits 2 when the rules file cannot be read', async () => {
    const rulesFile = path.join(repo, '.archprint', 'rules.json');
    rmSync(rulesFile);
    mkdirSync(rulesFile);
    await run(['check', '--base', 'main']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('cannot read the adopted rules');
    expect(process.exitCode).toBe(2);
  });

  it('exits 2 when the rules file has been tampered with', async () => {
    writeFileSync(
      path.join(repo, '.archprint', 'rules.json'),
      '{"format":1,"rules":[{"id":"x","family":"layer"}]}',
    );
    await run(['check', '--base', 'main']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('no valid id or family');
    expect(process.exitCode).toBe(2);
  });

  it('makes removing a rule in the change visible', async () => {
    const rulesFile = path.join(repo, '.archprint', 'rules.json');
    const rules = JSON.parse(readFileSync(rulesFile, 'utf8'));
    rules.rules = rules.rules.filter((rule: { id: string }) => rule.id !== 'AP-001');
    writeFileSync(rulesFile, JSON.stringify(rules));
    commitAll('drop AP-001');
    await run(['check', '--base', 'main']);
    expect(output()).toContain('Rule AP-001 was removed in this change');
  });

  it('does not run, visibly, where archprint was never set up', async () => {
    rmSync(path.join(repo, '.archprint', 'config.json'));
    await run(['check', '--base', 'main']);
    expect(output()).toContain('archprint check did not run: no .archprint/config.json');
    expect(process.exitCode).toBe(0);
  });

  it('exits 2 with guidance when the base cannot be found', async () => {
    await run(['check', '--base', 'no-such-branch']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('fetch-depth: 0');
    expect(process.exitCode).toBe(2);
  });

  it('exits 2 when no base is given and the repository has no origin/HEAD', async () => {
    await run(['check']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('--base origin/main');
    expect(process.exitCode).toBe(2);
  });

  it('does not run, visibly, where no rules were generated', async () => {
    rmSync(path.join(repo, '.archprint', 'rules.json'));
    await run(['check', '--base', 'main', '--format', 'github']);
    expect(output()).toContain('::notice title=archprint check did not run::');
    expect(process.exitCode).toBe(0);
  });

  it('rejects unknown options before touching git', async () => {
    await expect(run(['check', '--fail-on', 'always'])).rejects.toThrow(/--fail-on/);
    await expect(run(['check', '--format', 'xml'])).rejects.toThrow(/--format/);
  });

  it('reads renames with their new path from git', () => {
    git('mv', `${app}/lib/util.ts`, `${app}/lib/utils.ts`);
    commitAll('rename');
    const commit = git('rev-parse', 'main').trim();
    expect(renamedPaths(repo, commit).get(`${app}/lib/util.ts`)).toBe(`${app}/lib/utils.ts`);
  });
});
