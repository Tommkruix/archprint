import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStated } from '../../src/cli/adopted-rules.js';
import { runCheck } from '../../src/cli/check.js';
import { gitEnv } from '../../src/cli/git-env.js';
import { buildProgram } from '../../src/cli/program.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SENTENCE = 'Library code must never log to the console.';
const MAPPING = {
  rules: [
    {
      template: 'inferred',
      source: { file: 'CLAUDE.md', quote: SENTENCE },
      rule: 'console-isolation',
    },
  ],
};

describe('a context sentence an adopted inferred rule enforces', { timeout: 120_000 }, () => {
  let cwd: string;
  let repo: string;
  let log: ReturnType<typeof vi.spyOn>;
  const printed = (): string => log.mock.calls.flat().join('\n');
  const run = (...args: string[]) => buildProgram('9.9.9').parseAsync(args, { from: 'user' });
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, env: gitEnv(), encoding: 'utf8' });
  const outDir = (): string => path.join(repo, '.archprint');
  const unchecked = (): string[] => {
    const result = runCheck({ cwd: repo, out: '.archprint', base: 'main' });
    if (result.status !== 'checked') throw new Error(`check did not run: ${result.status}`);
    return result.context.files.flatMap((file) => file.ruleLike.map((entry) => entry.text));
  };

  beforeEach(async () => {
    cwd = process.cwd();
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-stated-')));
    cpSync(path.join(here, '..', 'fixtures', 'console-isolation-auto'), repo, { recursive: true });
    writeFileSync(path.join(repo, 'CLAUDE.md'), '# Rules\n');
    writeFileSync(path.join(repo, 'mapping.json'), JSON.stringify(MAPPING));
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.com');
    process.chdir(repo);
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run('generate', '.', '--fast');
    git('add', '-A');
    git('commit', '-qm', 'adopt');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(path.join(repo, 'CLAUDE.md'), `# Rules\n- ${SENTENCE}\n`);
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  it('is unchecked until generate --declare records the mapping, then check counts it', async () => {
    expect(unchecked()).toEqual([SENTENCE]);
    await run('generate', '.', '--fast', '--declare', 'mapping.json');
    expect(printed()).toContain(
      `Recorded 1 sentence(s) an adopted rule already enforces, so archprint check counts them as checked:\n  console-isolation  "${SENTENCE}" (CLAUDE.md)`,
    );
    expect(printed()).not.toContain('already an archprint rule');
    expect(readStated(outDir())).toEqual([
      { rule: 'console-isolation', file: 'CLAUDE.md', quote: SENTENCE },
    ]);
    expect(unchecked()).toEqual([]);

    await run('generate', '.', '--fast');
    expect(readStated(outDir())).toHaveLength(1);
  });

  it('drops the record with the rule, on --remove or --reset', async () => {
    await run('generate', '.', '--fast', '--declare', 'mapping.json');
    await run('generate', '.', '--fast', '--remove', 'console-isolation');
    expect(readStated(outDir())).toEqual([]);
    expect(readFileSync(path.join(outDir(), 'config.json'), 'utf8')).not.toContain('"stated"');

    await run('generate', '.', '--fast', '--rules', 'console-isolation');
    await run('generate', '.', '--fast', '--declare', 'mapping.json');
    await run('generate', '.', '--fast', '--reset');
    expect(readStated(outDir())).toEqual([]);
  });

  it('is recorded when the same run adopts the rule with --rules', async () => {
    await run('generate', '.', '--fast', '--remove', 'console-isolation');
    await run(
      'generate',
      '.',
      '--fast',
      '--rules',
      'console-isolation',
      '--declare',
      'mapping.json',
    );
    expect(readStated(outDir())).toEqual([
      { rule: 'console-isolation', file: 'CLAUDE.md', quote: SENTENCE },
    ]);
  });

  it('is refused, naming --rules, when the rule it maps to is not adopted', async () => {
    await run('generate', '.', '--fast', '--remove', 'console-isolation');
    await run('generate', '.', '--fast', '--declare', 'mapping.json');
    expect(printed()).toContain(
      'already an archprint rule: adopt it with --rules console-isolation',
    );
    expect(readStated(outDir())).toEqual([]);
  });

  it('refuses a stated list that is not { rule, file, quote }, which --reset replaces', async () => {
    const file = path.join(outDir(), 'config.json');
    const config = JSON.parse(readFileSync(file, 'utf8')) as object;
    writeFileSync(file, JSON.stringify({ ...config, stated: [{ rule: 'console-isolation' }] }));
    await expect(run('generate', '.', '--fast')).rejects.toThrow(
      '"stated" must be a list of { rule, file, quote }. Fix it, or run archprint generate --reset.',
    );
    await run('generate', '.', '--fast', '--reset');
    expect(readStated(outDir())).toEqual([]);
  });
});
