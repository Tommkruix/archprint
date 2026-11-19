import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAdoptedRules } from '../../src/cli/adopted-rules.js';
import { buildProgram } from '../../src/cli/program.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RULE = 'no-helpers-to-views';
const OTHERS = ['console-isolation', 'no-cycles'];

describe('removing an adopted rule with generate --remove', () => {
  let cwd: string;
  let repo: string;
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  const printed = (): string => log.mock.calls.flat().join('\n');
  const generate = (...args: string[]) =>
    buildProgram('9.9.9').parseAsync(['generate', '.', '--fast', ...args], { from: 'user' });
  const outFile = (name: string): string => path.join(repo, '.archprint', name);
  const adoptedIds = (): string[] =>
    readAdoptedRules(path.join(repo, '.archprint'))!.map((rule) => rule.id);
  const recorded = (): unknown =>
    (JSON.parse(readFileSync(outFile('config.json'), 'utf8')) as { removed?: unknown }).removed;

  beforeEach(() => {
    cwd = process.cwd();
    repo = mkdtempSync(path.join(tmpdir(), 'archprint-remove-'));
    cpSync(path.join(here, '..', 'fixtures', 'layer-auto'), repo, { recursive: true });
    rmSync(path.join(repo, '.dependency-cruiser.json'));
    process.chdir(repo);
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('removes a default rule by any of its names, and later runs leave it out, plain or by family', async () => {
    await generate('--include-structural');
    expect(adoptedIds()).toEqual([...OTHERS, RULE]);

    await generate('--include-structural', '--remove', 'archprint/No-Helpers-To-Views');
    expect(printed()).toContain(
      `Removed 1 adopted rule(s): ${RULE}. Later runs of generate leave them out; adopt one again with --rules <id>`,
    );
    expect(adoptedIds()).toEqual(OTHERS);
    expect(recorded()).toEqual([RULE]);

    await generate('--include-structural');
    await generate('--include-structural', '--only', 'layer');
    expect(adoptedIds()).toEqual(OTHERS);
    expect(recorded()).toEqual([RULE]);
    expect(readFileSync(outFile('eslint.mjs'), 'utf8')).not.toContain(RULE);
  });

  it('leaves a removed role rule out of the ts-arch tests too', async () => {
    const roleRule = 'no-repository-to-service';
    for (const entry of readdirSync(repo)) rmSync(path.join(repo, entry), { recursive: true });
    cpSync(path.join(here, '..', 'fixtures', 'role-layering-auto'), repo, { recursive: true });
    await generate('--include-structural', '--expand');
    expect(readFileSync(outFile('architecture.archprint.ts'), 'utf8')).toContain(roleRule);
    await generate('--include-structural', '--remove', roleRule);
    await generate('--include-structural', '--expand');
    expect(adoptedIds()).toEqual(['no-cycles']);
    expect(existsSync(outFile('architecture.archprint.ts'))).toBe(false);
  });

  it('removes a rule a file now breaks, which would otherwise stop generate', async () => {
    await generate('--include-structural');
    writeFileSync(
      path.join(repo, 'helpers', 'slip.ts'),
      "import { v1 } from '../views/v1';\nexport const slip = v1;\n",
    );
    await expect(generate('--include-structural')).rejects.toThrow(`  ${RULE}: helpers/slip.ts`);
    await generate('--include-structural', '--remove', RULE);
    expect(adoptedIds()).toEqual(OTHERS);
  });

  it('adopts it again with --rules, or --reset, which clear the record', async () => {
    await generate('--include-structural');
    await generate('--include-structural', '--remove', RULE);
    await generate('--include-structural', '--rules', RULE);
    expect(adoptedIds()).toEqual([...OTHERS, RULE]);
    expect(recorded()).toBeUndefined();

    await generate('--include-structural', '--remove', RULE);
    await generate('--include-structural', '--reset');
    expect(adoptedIds()).toEqual([...OTHERS, RULE]);
    expect(recorded()).toBeUndefined();
  });

  it('refuses a rule that is not adopted, or one --rules also names, writing nothing', async () => {
    await generate('--include-structural');
    const before = readFileSync(outFile('config.json'), 'utf8');
    await expect(generate('--remove', 'no-such-rule')).rejects.toThrow(
      `--remove names no adopted rule: no-such-rule. Adopted rules: ${[...OTHERS, RULE].join(', ')}.`,
    );
    await expect(
      generate('--include-structural', '--remove', RULE, '--rules', RULE),
    ).rejects.toThrow(`--remove and --rules both name ${RULE}; keep it in one of them.`);
    expect(readFileSync(outFile('config.json'), 'utf8')).toBe(before);
  });

  it('refuses an empty list, and --reset alongside it, writing nothing', async () => {
    await generate('--include-structural');
    const before = readFileSync(outFile('config.json'), 'utf8');
    await generate('--remove', ',');
    expect(error.mock.calls.flat().join('\n')).toContain('--remove needs at least one rule id');
    await generate('--remove', RULE, '--reset');
    expect(error.mock.calls.flat().join('\n')).toContain(
      '--reset already removes every adopted rule',
    );
    expect(process.exitCode).toBe(1);
    expect(readFileSync(outFile('config.json'), 'utf8')).toBe(before);
  });

  it('refuses a removed list that is not rule ids, which --reset replaces', async () => {
    await generate('--include-structural');
    const config = JSON.parse(readFileSync(outFile('config.json'), 'utf8')) as object;
    writeFileSync(outFile('config.json'), JSON.stringify({ ...config, removed: RULE }));
    await expect(generate('--include-structural')).rejects.toThrow(
      '"removed" must be a list of rule ids. Fix it, or run archprint generate --reset.',
    );
    await generate('--include-structural', '--reset');
    expect(adoptedIds()).toEqual([...OTHERS, RULE]);
  });
});
