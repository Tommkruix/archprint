import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
      'CLAUDE.md': '# Rules\n- Components never call fetch directly.\n',
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

  it('reports a second break added to a file whose first one is recorded, listing both', () => {
    put('src/components/card.tsx', FETCH + "export const More = () => fetch('/y');\n");
    const result = runCheck({ cwd: repo, out: '.archprint', base: 'main' });
    if (result.status !== 'checked') throw new Error(`check did not run: ${result.status}`);
    expect(
      result.introduced.map((finding) => [finding.ruleId, finding.file, finding.line]),
    ).toEqual([
      ['doc-no-fetch-in-components', 'src/components/card.tsx', 1],
      ['doc-no-fetch-in-components', 'src/components/card.tsx', 2],
    ]);
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
