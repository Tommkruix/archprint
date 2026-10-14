import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAdoptedRules } from '../../src/cli/adopted-rules.js';
import { runAllow } from '../../src/cli/allow.js';
import { evaluateRules } from '../../src/cli/check-evaluate.js';
import { buildProgram } from '../../src/cli/program.js';
import { nextApp, writeTree } from './layer-app.js';

const LAYER_RULE = 'no-lib-to-app';
const leak = "import { Page } from '../app/page';\nexport const x = Page;\n";

describe('layer rules through the CLI', () => {
  let cwd: string;
  let repo: string;
  const out = (...segments: string[]): string => path.join(repo, '.archprint', ...segments);
  const generate = (...args: string[]): Promise<unknown> =>
    buildProgram('9.9.9').parseAsync(['generate', '.', '--emit', 'eslint', ...args], {
      from: 'user',
    });

  beforeEach(() => {
    cwd = process.cwd();
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-layer-cli-')));
    writeTree(repo, nextApp());
    process.chdir(repo);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  it('adopts the layer rule, so check reports a new leak and allow exempts it in ESLint', async () => {
    await generate('--include-structural');
    const adopted = readAdoptedRules(out())!;
    expect(adopted.map((rule) => rule.id)).toContain(LAYER_RULE);
    expect(readFileSync(out('eslint.mjs'), 'utf8')).toContain(`"name": "${LAYER_RULE}"`);

    writeFileSync(path.join(repo, 'src', 'lib', 'leak.ts'), leak);
    const findings = evaluateRules(repo, adopted).filter((f) => f.ruleId === LAYER_RULE);
    expect(findings.map((finding) => finding.file).sort()).toEqual([
      'src/lib/leak.ts',
      'src/lib/legacy.ts',
    ]);

    const message = runAllow({
      cwd: repo,
      out: '.archprint',
      rule: LAYER_RULE,
      file: 'src/lib/leak.ts',
      reason: 'migrating',
    });
    expect(message).toContain('update the generated rules');
    await generate('--include-structural');
    expect(readFileSync(out('eslint.mjs'), 'utf8')).toContain('"src/lib/leak.ts"');
  });

  it('keeps layer rules held for review without --include-structural', async () => {
    await generate();
    expect(readFileSync(out('eslint.mjs'), 'utf8')).not.toContain(LAYER_RULE);
    expect(readAdoptedRules(out())!.map((rule) => rule.id)).not.toContain(LAYER_RULE);
  });

  it('selects a layer rule by id or by the label scan prints', async () => {
    await generate('--include-structural', '--rules', 'lib !-> app');
    expect(readAdoptedRules(out())!.map((rule) => rule.id)).toEqual([LAYER_RULE]);
    await generate('--include-structural', '--rules', LAYER_RULE);
    expect(readAdoptedRules(out())!.map((rule) => rule.id)).toEqual([LAYER_RULE]);
  });

  it('refuses an unknown --rules entry before touching the generated files', async () => {
    await generate('--include-structural');
    const before = readFileSync(out('eslint.mjs'), 'utf8');
    const refusal = generate('--include-structural', '--rules', 'AP-404');
    await expect(refusal).rejects.toThrow(
      /--rules names no rule this run would generate: AP-404\. Rules available: .*no-lib-to-app/,
    );
    await expect(refusal).rejects.not.toThrow(/--include-structural/);
    expect(readFileSync(out('eslint.mjs'), 'utf8')).toBe(before);
  });

  it('refuses an empty --rules before touching the generated files', async () => {
    await generate('--include-structural');
    const before = readFileSync(out('eslint.mjs'), 'utf8');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await generate('--include-structural', '--rules', ',');
    expect(errors).toHaveBeenCalledWith(
      expect.stringMatching(/--rules needs at least one rule id/),
    );
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    expect(readFileSync(out('eslint.mjs'), 'utf8')).toBe(before);
  });

  it('writes the layer rule to dependency-cruiser instead when it enforces, with allowed files exempt', async () => {
    await generate('--include-structural');
    writeFileSync(path.join(repo, 'src', 'lib', 'leak.ts'), leak);
    runAllow({
      cwd: repo,
      out: '.archprint',
      rule: LAYER_RULE,
      file: 'src/lib/leak.ts',
      reason: 'x',
    });
    await buildProgram('9.9.9').parseAsync(
      ['generate', '.', '--emit', 'dependency-cruiser', '--include-structural'],
      { from: 'user' },
    );
    expect(existsSync(out('eslint.mjs'))).toBe(false);
    const depcruise = JSON.parse(readFileSync(out('dependency-cruiser.json'), 'utf8')) as {
      forbidden: { name: string; from: { pathNot: string[] } }[];
    };
    const rule = depcruise.forbidden.find((candidate) => candidate.name === LAYER_RULE)!;
    expect(rule.from.pathNot).toContain('(^|/)src/lib/leak\\.ts$');
  });
});
