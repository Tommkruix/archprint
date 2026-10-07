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
  const configFile = (): string => path.join(repo, '.archprint', 'config.json');
  const readConfigJson = () => JSON.parse(readFileSync(configFile(), 'utf8'));
  const editConfig = (edit: (config: Record<string, unknown>) => void): void => {
    const config = readConfigJson();
    edit(config);
    writeFileSync(configFile(), JSON.stringify(config));
  };
  const adoptedRuleIds = (): string[] =>
    readConfigJson().rules.map((rule: { id: string }) => rule.id);
  /** Rewrites the setup the way 0.9.0 to 0.11.x laid it out: rules and exceptions in their own files. */
  const toLegacyLayout = (): void => {
    const config = readConfigJson();
    const dir = path.join(repo, '.archprint');
    writeFileSync(
      path.join(dir, 'rules.json'),
      JSON.stringify({ format: 1, archprintVersion: '0.11.0', rules: config.rules }),
    );
    if (config.allowed.length > 0) {
      writeFileSync(
        path.join(dir, 'allow.json'),
        JSON.stringify({ format: 1, entries: config.allowed }),
      );
    }
    delete config.rules;
    delete config.allowed;
    config.managed.files.push('.archprint/rules.json');
    writeFileSync(configFile(), JSON.stringify(config));
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
    const ap001 = readConfigJson().rules.find((rule: { id: string }) => rule.id === 'AP-001');
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

  it('records the adopted rules in config.json with the mode they were generated in', () => {
    const config = readConfigJson();
    expect(config.archprintVersion).toBe('9.9.9');
    const ap001 = config.rules.find((rule: { id: string }) => rule.id === 'AP-001');
    expect(ap001).toMatchObject({ family: 'forbidden-imports', mode: 'deep' });
    expect(config.allowed).toEqual([]);
    expect(readdirSync(path.join(repo, '.archprint')).sort()).toEqual([
      'config.json',
      'eslint.mjs',
    ]);
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

  it('treats unreadable rules on the base as no adopted rules', () => {
    git('checkout', '-q', 'main');
    const current = readFileSync(configFile(), 'utf8');
    editConfig((config) => {
      config.rules = 7;
    });
    commitAll('rules from another version');
    git('checkout', '-q', '-b', 'regenerated');
    writeFileSync(configFile(), current);
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

  it('exits 2 when a legacy rules file cannot be read', async () => {
    toLegacyLayout();
    const rulesFile = path.join(repo, '.archprint', 'rules.json');
    rmSync(rulesFile);
    mkdirSync(rulesFile);
    await run(['check', '--base', 'main']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('cannot read the adopted rules');
    expect(process.exitCode).toBe(2);
  });

  it('exits 2 when the rules have been tampered with', async () => {
    editConfig((config) => {
      config.rules = [{ id: 'x', family: 'layer' }];
    });
    await run(['check', '--base', 'main']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('no valid id or family');
    expect(process.exitCode).toBe(2);
  });

  const dropRule = (id: string): void =>
    editConfig((config) => {
      config.rules = (config.rules as { id: string }[]).filter((rule) => rule.id !== id);
    });

  it('makes removing a rule in the change visible', async () => {
    dropRule('AP-001');
    commitAll('drop AP-001');
    await run(['check', '--base', 'main']);
    expect(output()).toContain('Rule AP-001 was removed in this change');
  });

  const baseWithout = (relative: string): void => {
    git('checkout', '-q', 'main');
    git('rm', '-rq', relative);
    commitAll(`drop ${relative}`);
    git('checkout', '-q', '-B', 'feature');
  };

  it('does not run, visibly, where archprint was never set up', async () => {
    baseWithout('.archprint');
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
    git('checkout', '-q', 'main');
    editConfig((config) => {
      delete config.rules;
    });
    commitAll('a setup from before 0.9.0');
    git('checkout', '-q', '-B', 'feature');
    await run(['check', '--base', 'main', '--format', 'github']);
    expect(output()).toContain('::notice title=archprint check did not run::');
    expect(process.exitCode).toBe(0);
  });

  const adoptedIds = (): string => adoptedRuleIds().join(', ');

  it('reports every adopted rule a change stops checking when it deletes the rules from config.json', async () => {
    const ids = adoptedIds();
    editConfig((config) => {
      delete config.rules;
    });
    commitAll('stop checking');
    await run(['check', '--base', 'main', '--format', 'github', '--fail-on', 'new']);
    expect(output()).toContain(
      `::warning file=.archprint/config.json,title=archprint rules removed::This change removes the adopted rules in .archprint/config.json, so the ${ids.split(', ').length} rule(s) adopted on the base commit are no longer checked: ${ids}.`,
    );
    expect(process.exitCode).toBe(0);
  });

  it('reports the rules as removed when a change deletes a legacy rules.json', async () => {
    const ids = adoptedIds();
    git('checkout', '-q', 'main');
    toLegacyLayout();
    commitAll('a 0.11 setup');
    git('checkout', '-q', '-B', 'feature');
    git('rm', '-q', '.archprint/rules.json');
    commitAll('stop checking');
    await run(['check', '--base', 'main', '--format', 'json']);
    expect(JSON.parse(output())).toMatchObject({
      status: 'rules-removed',
      missingFile: '.archprint/rules.json',
      removedInChange: ids.split(', '),
    });
  });

  it('compares with a base commit that still has the legacy layout, counting no rule or exception as new', async () => {
    git('checkout', '-q', 'main');
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    await run(['generate', app]);
    toLegacyLayout();
    commitAll('a 0.11 setup with one exception');
    git('checkout', '-q', '-B', 'feature');
    await run(['generate', app]);
    commitAll('regenerate into two files');
    logSpy.mockClear();
    await run(['check', '--base', 'main', '--format', 'json']);
    expect(JSON.parse(output())).toMatchObject({
      status: 'checked',
      introduced: [],
      adoptedInChange: [],
      removedInChange: [],
      allowedInChange: [],
    });
  });

  it('folds a legacy rules.json and allow.json into config.json on generate, and deletes them', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    const ids = adoptedRuleIds();
    toLegacyLayout();
    logSpy.mockClear();
    await run(['generate', app]);
    expect(output()).toContain(
      'Moved .archprint/rules.json and .archprint/allow.json into .archprint/config.json.',
    );
    expect(output()).toContain('removed 1 stale archprint output(s)');
    expect(readdirSync(path.join(repo, '.archprint')).sort()).toEqual([
      'config.json',
      'eslint.mjs',
    ]);
    const config = readConfigJson();
    expect(config.rules.map((rule: { id: string }) => rule.id)).toEqual(ids);
    expect(config.allowed).toEqual([
      { rule: 'AP-001', file: 'app/api/orders/route.ts', reason: reasonText },
    ]);
    expect(config.managed.files).not.toContain('.archprint/rules.json');
  });

  it('does not call a broken config file removed', async () => {
    writeFileSync(path.join(repo, '.archprint', 'config.json'), '{ not json');
    commitAll('break the config');
    await run(['check', '--base', 'main']);
    expect(output()).toContain('archprint check did not run: no .archprint/config.json');
  });

  it('reports the rules as removed when a change deletes the whole archprint setup', async () => {
    const ids = adoptedIds();
    git('rm', '-rq', '.archprint');
    commitAll('remove archprint');
    await run(['check', '--base', 'main', '--format', 'json']);
    expect(JSON.parse(output())).toMatchObject({
      status: 'rules-removed',
      missingFile: '.archprint/config.json',
      removedInChange: ids.split(', '),
    });
  });

  it('rejects unknown options before touching git', async () => {
    await expect(run(['check', '--fail-on', 'always'])).rejects.toThrow(/--fail-on/);
    await expect(run(['check', '--format', 'xml'])).rejects.toThrow(/--format/);
  });

  const orders = `${app}/app/api/orders/route.ts`;
  const reasonText = 'The health probe needs a raw query.';

  it('accepts a new rule break allowed with a reason and shows it in the pull request', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    expect(output()).toContain('Allowed AP-001 in app/api/orders/route.ts');
    commitAll('allow a direct query');
    logSpy.mockClear();
    const summary = path.join(repo, 'summary.md');
    process.env.GITHUB_STEP_SUMMARY = summary;
    await run(['check', '--base', 'main', '--format', 'github', '--fail-on', 'new']);
    expect(output()).toContain(
      `::notice file=${orders},title=archprint%3A AP-001 allowed::Allowed with a reason: ${reasonText}`,
    );
    expect(output()).not.toContain('::error');
    expect(readFileSync(summary, 'utf8')).toContain(
      '**Allowed with a reason in this change (1):**',
    );
    expect(process.exitCode).toBe(0);
  });

  it('allows an exception in a framework route folder, and check and generate keep working', async () => {
    const dynamic = `${app}/app/api/orders/[id]/(admin)/route.ts`;
    write('app/api/orders/[id]/(admin)/route.ts', directDbRoute);
    await run(['allow', 'AP-001', dynamic, '--reason', reasonText]);
    commitAll('allow a direct query in a dynamic route');
    logSpy.mockClear();
    await run(['check', '--base', 'main', '--format', 'json']);
    expect(JSON.parse(output())).toMatchObject({
      status: 'checked',
      introduced: [],
      allowedInChange: [{ rule: 'AP-001', file: 'app/api/orders/[id]/(admin)/route.ts' }],
    });
    await run(['generate', app]);
    expect(process.exitCode).toBe(0);
    expect(readConfigJson().allowed).toHaveLength(1);
  });

  it('refuses to allow without a reason, an unknown rule, or a file the rule does not report', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders]);
    await run(['allow', 'AP-999', orders, '--reason', reasonText]);
    await run(['allow', 'AP-001', `${app}/lib/util.ts`, '--reason', reasonText]);
    const errors = errSpy.mock.calls.flat().join('\n');
    expect(errors).toContain('Give the reason');
    expect(errors).toContain('No adopted rule "AP-999"');
    expect(errors).toContain('AP-001 reports nothing in lib/util.ts');
    expect(readConfigJson().allowed).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it('lists an existing violation allowed in the change as allowed, not fixed', async () => {
    git('checkout', '-q', 'main');
    await adoptWithOneException();
    commitAll('adopt with one known exception');
    git('checkout', '-q', '-b', 'allow-legacy');
    await run(['allow', 'AP-001', `${app}/app/api/legacy/route.ts`, '--reason', reasonText]);
    commitAll('allow the legacy route');
    logSpy.mockClear();
    await run(['check', '--base', 'main', '--format', 'json']);
    expect(JSON.parse(output())).toMatchObject({
      introduced: [],
      fixed: [],
      allowedInChange: [{ rule: 'AP-001', file: 'app/api/legacy/route.ts', reason: reasonText }],
    });
  });

  it('does not list an exception again once the base branch already allows it', async () => {
    git('checkout', '-q', 'main');
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    commitAll('allow on main');
    git('checkout', '-q', '-B', 'feature');
    write('lib/extra.ts', 'export const extra = 2;\n');
    commitAll('unrelated change');
    logSpy.mockClear();
    await run(['check', '--base', 'main', '--format', 'json']);
    expect(JSON.parse(output())).toMatchObject({ introduced: [], allowedInChange: [] });
  });

  it('treats a broken allowed list on the base branch as allowing nothing, so every exception shows', async () => {
    git('checkout', '-q', 'main');
    editConfig((config) => {
      config.allowed = [{ rule: 'AP-001' }];
    });
    commitAll('a broken allow list on main');
    git('checkout', '-q', '-B', 'feature');
    write('app/api/orders/route.ts', directDbRoute);
    editConfig((config) => {
      config.allowed = [];
    });
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    commitAll('fix the list and allow one');
    logSpy.mockClear();
    await run(['check', '--base', 'main', '--format', 'json']);
    expect(JSON.parse(output()).allowedInChange).toEqual([
      { rule: 'AP-001', file: 'app/api/orders/route.ts', reason: reasonText },
    ]);
  });

  it('reports an allowed exception the code no longer needs', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    write(
      'app/api/orders/route.ts',
      "export async function GET() { return new Response('ok'); }\n",
    );
    commitAll('allow, then fix it anyway');
    logSpy.mockClear();
    await run(['check', '--base', 'main', '--format', 'json']);
    expect(JSON.parse(output())).toMatchObject({
      allowedInChange: [],
      unusedAllows: [{ rule: 'AP-001', file: 'app/api/orders/route.ts' }],
    });
  });

  it('exits 2 when the allowed list is broken, rather than ignoring it', async () => {
    editConfig((config) => {
      config.allowed = [{ rule: 'AP-001', file: 'a.ts' }];
    });
    await run(['check', '--base', 'main']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('cannot read the allowed exceptions');
    expect(process.exitCode).toBe(2);
  });

  it('keeps the rule adopted when regenerating after allowing the exception that would have dropped it', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    await run(['generate', app]);
    expect(adoptedRuleIds()).toContain('AP-001');
    expect(readConfigJson().allowed).toHaveLength(1);
    expect(readFileSync(path.join(repo, '.archprint', 'eslint.mjs'), 'utf8')).toContain(
      `${app}/app/api/orders/route.ts`,
    );
    commitAll('allow and regenerate');
    logSpy.mockClear();
    await run(['check', '--base', 'main', '--format', 'json']);
    expect(JSON.parse(output())).toMatchObject({
      introduced: [],
      removedInChange: [],
      allowedInChange: [{ rule: 'AP-001', file: 'app/api/orders/route.ts' }],
    });
  });

  it('never lets an allowance promote a rule that is not adopted', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    dropRule('AP-001');
    await run(['generate', app]);
    expect(adoptedRuleIds()).not.toContain('AP-001');
  });

  it('accepts the file path as check prints it, relative to the app', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', 'app/api/orders/route.ts', '--reason', reasonText]);
    expect(output()).toContain('Allowed AP-001 in app/api/orders/route.ts');
  });

  it('removes an exception with --remove', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    expect(readConfigJson().allowed).toHaveLength(1);
    await run(['allow', 'AP-001', orders, '--remove']);
    expect(readConfigJson().allowed).toEqual([]);
  });

  it('moves a legacy allow.json into config.json on the next allow', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    toLegacyLayout();
    await run(['allow', 'AP-001', orders, '--remove']);
    expect(existsSync(path.join(repo, '.archprint', 'allow.json'))).toBe(false);
    expect(readConfigJson().allowed).toEqual([]);
  });

  it('regenerates past a leftover rules.json that is a folder, leaving it in place', async () => {
    mkdirSync(path.join(repo, '.archprint', 'rules.json'));
    await run(['generate', app]);
    expect(process.exitCode).toBe(0);
    expect(adoptedRuleIds()).toContain('AP-001');
    expect(lstatSync(path.join(repo, '.archprint', 'rules.json')).isDirectory()).toBe(true);
  });

  it('ejects a legacy layout completely, rules.json and allow.json included', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    toLegacyLayout();
    expect(existsSync(path.join(repo, '.archprint', 'allow.json'))).toBe(true);
    await run(['eject']);
    expect(existsSync(path.join(repo, '.archprint'))).toBe(false);
  });

  it('keeps the rules and allowed exceptions when generate --rule records another output', async () => {
    write('app/api/orders/route.ts', directDbRoute);
    await run(['allow', 'AP-001', orders, '--reason', reasonText]);
    const ids = adoptedRuleIds();
    editConfig((config) => {
      config.team = { owner: 'platform' };
    });
    await run(['generate', app, '--rule', 'AP-001']);
    expect(readConfigJson().team).toEqual({ owner: 'platform' });
    expect(output()).toContain('generated .archprint/');
    expect(adoptedRuleIds()).toEqual(ids);
    expect(readConfigJson().allowed).toEqual([
      { rule: 'AP-001', file: 'app/api/orders/route.ts', reason: reasonText },
    ]);
  });

  it('reads renames with their new path from git', () => {
    git('mv', `${app}/lib/util.ts`, `${app}/lib/utils.ts`);
    commitAll('rename');
    const commit = git('rev-parse', 'main').trim();
    expect(renamedPaths(repo, commit).get(`${app}/lib/util.ts`)).toBe(`${app}/lib/utils.ts`);
  });
});
