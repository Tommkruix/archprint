import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateConfig } from '../../src/cli/archprint-config.js';
import { readAdoptedRules } from '../../src/cli/adopted-rules.js';
import { adoptedAllowances, excludeAllowed } from '../../src/cli/allowed-evidence.js';
import { runAllow } from '../../src/cli/allow.js';
import { writeLayout, type WriteLayoutOptions } from '../../src/cli/layout.js';
import { buildRecommendations } from '../../src/cli/recommend.js';
import { buildProgram } from '../../src/cli/program.js';
import { NewViolationsError } from '../../src/cli/ratchet.js';
import { scanRepo } from '../../src/cli/scan.js';
import type { InstalledEnforcers } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ESLINT: InstalledEnforcers = {
  eslint: true,
  eslintPluginImport: false,
  dependencyCruiser: false,
  biome: false,
};
const LOGS = "export const f = () => console.log('x');\n";

describe('the exceptions of adopted rules only shrink', () => {
  let repo: string;
  let outDir: string;
  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'archprint-ratchet-'));
    cpSync(path.join(here, '..', 'fixtures', 'console-isolation-auto'), repo, { recursive: true });
    for (let index = 0; index < 80; index++) {
      writeFileSync(path.join(repo, 'src', `clean${index}.ts`), `export const v${index} = 1;\n`);
    }
    outDir = path.join(repo, '.archprint');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const write = (options: Partial<WriteLayoutOptions> = {}) => {
    const scan = excludeAllowed(scanRepo(repo), adoptedAllowances(outDir));
    return writeLayout(scan, outDir, {
      enforcers: ESLINT,
      mode: 'fast',
      version: '9.9.9',
      recommendations: buildRecommendations(scan, new Set(), ESLINT),
      app: '.',
      cwd: repo,
      ...options,
    });
  };
  const consoleRule = () =>
    readAdoptedRules(outDir)!.find((rule) => rule.id === 'console-isolation')!;
  const outputs = (): [string, string][] =>
    readdirSync(outDir).map((name) => [name, readFileSync(path.join(outDir, name), 'utf8')]);
  const logIn = (file: string): void => writeFileSync(path.join(repo, 'src', file), LOGS);

  it('records the exceptions a rule had when it was written', () => {
    logIn('legacy.ts');
    write();
    expect(consoleRule().exceptions).toEqual(['src/legacy.ts']);
  });

  it('refuses to absorb a new break, names it, and leaves the rules in force', () => {
    write();
    const before = outputs();
    logIn('leak.ts');
    expect(() => write()).toThrow(NewViolationsError);
    expect(() => write()).toThrow('  console-isolation: src/leak.ts');
    expect(outputs()).toEqual(before);
  });

  it('refuses a break that would drop the rule below the gate, instead of dropping it', () => {
    rmSync(repo, { recursive: true, force: true });
    cpSync(path.join(here, '..', 'fixtures', 'console-isolation-auto'), repo, { recursive: true });
    write();
    logIn('leak.ts');
    expect(() => write()).toThrow('  console-isolation: src/leak.ts');
    expect(consoleRule()).toBeDefined();
  });

  it('accepts a break allowed with a reason', () => {
    write();
    logIn('leak.ts');
    runAllow({
      cwd: repo,
      out: '.archprint',
      rule: 'console-isolation',
      file: 'src/leak.ts',
      reason: 'x',
    });
    write();
    expect(consoleRule().exceptions).toEqual([]);
    expect(readFileSync(path.join(outDir, 'eslint.mjs'), 'utf8')).toContain('src/leak.ts');
  });

  it('drops a fixed exception, reports it, and enforces the rule on that file again', () => {
    logIn('legacy.ts');
    write();
    expect(readFileSync(path.join(outDir, 'eslint.mjs'), 'utf8')).toContain('src/legacy.ts');
    writeFileSync(path.join(repo, 'src', 'legacy.ts'), 'export const quiet = 1;\n');
    const result = write();
    expect(result.fixed).toEqual([{ rule: 'console-isolation', exceptions: ['src/legacy.ts'] }]);
    expect(consoleRule().exceptions).toEqual([]);
    expect(readFileSync(path.join(outDir, 'eslint.mjs'), 'utf8')).not.toContain('src/legacy.ts');
  });

  it('records, and lists, the exceptions of a rule adopted before they were recorded', () => {
    write();
    const rules = readAdoptedRules(outDir)!.map((rule) => ({ ...rule, exceptions: undefined }));
    updateConfig(outDir, { rules });
    logIn('leak.ts');
    const result = write();
    expect(result.firstRecorded).toEqual([
      { rule: 'console-isolation', exceptions: ['src/leak.ts'] },
    ]);
    expect(consoleRule().exceptions).toEqual(['src/leak.ts']);
  });

  it('says on the command line which exceptions were fixed and which were recorded for the first time', async () => {
    const cwd = process.cwd();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const generate = () =>
      buildProgram('9.9.9').parseAsync(['generate', '.', '--fast'], { from: 'user' });
    const printed = (): string => log.mock.calls.flat().join('\n');
    try {
      process.chdir(repo);
      logIn('legacy.ts');
      await generate();
      updateConfig(outDir, {
        rules: readAdoptedRules(outDir)!.map((rule) => ({ ...rule, exceptions: undefined })),
      });
      await generate();
      expect(printed()).toContain(
        'Recorded the existing exceptions of rules adopted by an earlier archprint',
      );
      expect(printed()).toContain('  console-isolation: src/legacy.ts');
      log.mockClear();
      writeFileSync(path.join(repo, 'src', 'legacy.ts'), 'export const quiet = 1;\n');
      await generate();
      expect(printed()).toContain(
        'Fixed since the last run, so the rules now apply to them:\n  console-isolation: src/legacy.ts',
      );
    } finally {
      process.chdir(cwd);
      log.mockRestore();
    }
  });

  it('starts again with --reset', () => {
    write();
    logIn('leak.ts');
    write({ reset: true });
    expect(consoleRule().exceptions).toEqual(['src/leak.ts']);
  });
});
