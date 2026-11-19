import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCheck } from '../../src/cli/check.js';
import { gitEnv } from '../../src/cli/git-env.js';
import { buildProgram } from '../../src/cli/program.js';
import { callTool } from '../../src/mcp/server.js';
import { writeTree } from './layer-app.js';

const FETCH = "export const Card = () => fetch('/x');\n";
const RULE = {
  template: 'forbid-usage',
  source: { file: 'CLAUDE.md', quote: 'Components never call fetch directly.' },
  name: 'no-fetch-in-components',
  files: ['apps/web/src/components/**'],
  usage: ['fetch'],
};

const run = (args: string[]): Promise<unknown> =>
  buildProgram('9.9.9').parseAsync(args, { from: 'user' });

describe('archprint check and explain with a declared rule', { timeout: 120_000 }, () => {
  let cwd: string;
  let repo: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const output = (): string =>
    logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, env: gitEnv(), encoding: 'utf8' });
  const put = (file: string, source: string): void =>
    writeFileSync(path.join(repo, 'apps', 'web', file), source);

  beforeEach(async () => {
    cwd = process.cwd();
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-declared-check-')));
    writeTree(repo, {
      'CLAUDE.md':
        '# Rules\n- Components never call fetch directly.\n\nThe web app is a Next.js app.\n',
      'mapping.json': JSON.stringify({ rules: [RULE] }),
      'apps/web/tsconfig.json': '{}\n',
      'apps/web/src/components/card.tsx': FETCH,
      'apps/web/src/components/list.tsx': 'export const List = 1;\n',
    });
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.com');
    process.chdir(repo);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(['generate', 'apps/web', '--declare', 'mapping.json', '--baseline', '--fast']);
    git('add', '-A');
    git('commit', '-qm', 'adopt the rules CLAUDE.md states');
    git('checkout', '-q', '-b', 'feature');
    logSpy.mockClear();
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  it('reports a new break with its line, and leaves the recorded exception alone', () => {
    put('src/components/list.tsx', '\n' + FETCH);
    const result = runCheck({ cwd: repo, out: '.archprint', base: 'main' });
    if (result.status !== 'checked') throw new Error(`check did not run: ${result.status}`);
    expect(
      result.introduced.map((finding) => [finding.ruleId, finding.file, finding.line]),
    ).toEqual([['doc-no-fetch-in-components', 'src/components/list.tsx', 2]]);
    expect(result.exceptions.left).toBe(1);
  });

  const introducedLines = (): (number | null)[] => {
    const result = runCheck({ cwd: repo, out: '.archprint', base: 'main' });
    if (result.status !== 'checked') throw new Error(`check did not run: ${result.status}`);
    expect(new Set(result.introduced.map((finding) => finding.file))).toEqual(
      new Set(['src/components/card.tsx']),
    );
    return result.introduced.map((finding) => finding.line);
  };
  const MORE = "export const More = () => fetch('/y');\n";

  it('reports a second break added to a file whose first one is recorded, by the line the change added', () => {
    put('src/components/card.tsx', FETCH + MORE);
    expect(introducedLines()).toEqual([2]);
    put('src/components/card.tsx', MORE + FETCH);
    expect(introducedLines()).toEqual([1]);
  });

  it('lists every break of the kind when the change also edits the recorded one', () => {
    put('src/components/card.tsx', FETCH.replace("'/x'", "'/z'") + MORE);
    expect(introducedLines()).toEqual([1, 2]);
  });

  it('counts a fixed exception in the burn-down', () => {
    put('src/components/card.tsx', 'export const Card = 1;\n');
    const result = runCheck({ cwd: repo, out: '.archprint', base: 'main' });
    if (result.status !== 'checked') throw new Error(`check did not run: ${result.status}`);
    expect(result.introduced).toEqual([]);
    expect(result.exceptions.fixedInChange).toEqual([
      { rule: 'doc-no-fetch-in-components', exceptions: ['src/components/card.tsx'] },
    ]);
  });

  it('explains the rule with the team sentence, what it enforces and its exceptions', async () => {
    await run(['explain', 'archprint/doc-no-fetch-in-components']);
    expect(output()).toBe(
      [
        'doc-no-fetch-in-components  (stated in CLAUDE.md:2)',
        '  "Components never call fetch directly."',
        '  Enforces: files matching apps/web/src/components/** must not use the global fetch.',
        '  Your team stated this rule, so no confidence gate applies; archprint checks the code against it.',
        '  When last generated: 1 of 2 file(s) follow it; 1 recorded as exceptions, which generate only removes as they are fixed: src/components/card.tsx.',
        '  Exceptions (1): src/components/card.tsx',
        '  Enforced by the generated ESLint rule and archprint check; dependency-cruiser does not enforce declared rules.',
      ].join('\n'),
    );
  });

  const write = (file: string, source: string): void => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), source);
  };
  const checked = () => {
    const result = runCheck({ cwd: repo, out: '.archprint', base: 'main' });
    if (result.status !== 'checked') throw new Error(`check did not run: ${result.status}`);
    return result;
  };

  it('lists the rule-like sentence a change adds to CLAUDE.md, counting the others', () => {
    write(
      'CLAUDE.md',
      '# Rules\n- Components never call fetch directly.\n- Never import the database client in a page.\n\nThe web app is a Next.js app. Pages live in app/.\n',
    );
    expect(checked().context).toEqual({
      files: [
        {
          file: 'CLAUDE.md',
          unchecked: 2,
          ruleLike: [{ line: 3, text: 'Never import the database client in a page.' }],
        },
      ],
      stale: [],
    });
  });

  it("reads the changed context files that apply to the app, in path order, and not a sibling app's or one over 1 MB", () => {
    write('apps/web/AGENTS.md', 'Use the design system for buttons.\n');
    write('apps/admin/AGENTS.md', 'Never call fetch in the admin app.\n');
    write('.cursor/rules/react.mdc', '---\nglobs: apps/**\n---\n\nPrefer server components.\n');
    write(
      'CLAUDE.md',
      '# Rules\n- Components never call fetch directly.\n\nThe web app is a Next.js app.\n\nPages are thin.\n',
    );
    write('AGENTS.md', `${'x'.repeat(1_000_001)}\n`);
    expect(checked().context.files).toEqual([
      {
        file: '.cursor/rules/react.mdc',
        unchecked: 1,
        ruleLike: [{ line: 5, text: 'Prefer server components.' }],
      },
      { file: 'CLAUDE.md', unchecked: 1, ruleLike: [] },
      {
        file: 'apps/web/AGENTS.md',
        unchecked: 1,
        ruleLike: [{ line: 1, text: 'Use the design system for buttons.' }],
      },
    ]);
  });

  it('skips a symlinked context file, whose target is read under its own path', () => {
    symlinkSync('../../CLAUDE.md', path.join(repo, 'apps', 'web', 'CLAUDE.md'));
    expect(checked().context.files).toEqual([]);
  });

  it('counts a new sentence that states an adopted rule as checked', () => {
    write(
      'CLAUDE.md',
      '# Rules\n- Components never call fetch directly.\n\nThe web app is a Next.js app.\n\nRemember: Components never call fetch directly.\n',
    );
    expect(checked().context.files).toEqual([]);
  });

  it('compares a renamed context file with its old content, and finds the rule sentence gone from the old name', () => {
    git('mv', 'CLAUDE.md', 'AGENTS.md');
    write(
      'AGENTS.md',
      '# Rules\n- Components never call fetch directly.\n- Keep pages thin.\n\nThe web app is a Next.js app.\n',
    );
    const { context } = checked();
    expect(context.files).toEqual([
      { file: 'AGENTS.md', unchecked: 1, ruleLike: [{ line: 3, text: 'Keep pages thin.' }] },
    ]);
    expect(context.stale.map(({ rule, file }) => [rule.id, file])).toEqual([
      ['doc-no-fetch-in-components', 'CLAUDE.md'],
    ]);
  });

  it('warns on the pull request when the sentence behind an adopted rule is removed, and notes a new rule sentence', async () => {
    write('CLAUDE.md', '# Rules\n- Never import the database client in a page.\n');
    await run(['check', '--base', 'main', '--format', 'github']);
    const lines = output().split('\n');
    expect(lines).toContain(
      '::warning file=CLAUDE.md,line=2,title=archprint%3A doc-no-fetch-in-components sentence missing::The sentence behind doc-no-fetch-in-components is no longer in CLAUDE.md; the rule stays in force. Restore the sentence, or remove the rule with archprint generate --remove doc-no-fetch-in-components.',
    );
    expect(lines).toContain(
      '::notice file=CLAUDE.md,line=2,title=archprint%3A not enforced yet::This reads like a rule, and no archprint rule checks it yet. To enforce it, ask your agent to map it with archprint gap-report, then adopt it with archprint generate --declare; when an adopted rule already enforces it, the inferred template records that.',
    );
  });

  it('returns the context report through MCP', () => {
    write('CLAUDE.md', '# Rules\n- Components never call fetch directly.\n- Keep pages thin.\n');
    const response = callTool('archprint_check', { path: repo, base: 'main' });
    expect(JSON.parse(response.content[0]!.text)).toMatchObject({
      context: {
        files: [
          { file: 'CLAUDE.md', unchecked: 1, ruleLike: [{ line: 3, text: 'Keep pages thin.' }] },
        ],
        stale: [],
      },
    });
  });

  it('explains it through MCP, and names a declared rule that is not adopted', async () => {
    const response = callTool('archprint_explain', {
      id: 'doc-no-fetch-in-components',
      path: repo,
    });
    expect(JSON.parse(response.content[0]!.text)).toMatchObject({
      declared: { id: 'doc-no-fetch-in-components', exceptions: ['src/components/card.tsx'] },
      enforces: 'files matching apps/web/src/components/** must not use the global fetch',
    });
    await expect(run(['explain', 'doc-unknown'])).rejects.toThrow(
      'No declared rule "doc-unknown" in .archprint/config.json',
    );
  });
});
