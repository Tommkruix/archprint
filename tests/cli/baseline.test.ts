import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAdoptedRules } from '../../src/cli/adopted-rules.js';
import { BaselineError, baselineRuleIds, promoteBelowGate } from '../../src/cli/promote.js';
import { buildProgram } from '../../src/cli/program.js';
import { scanRepo } from '../../src/cli/scan.js';
import { evaluateGate } from '../../src/detector/confidence-gate.js';
import { generateRuleArtifacts } from '../../src/generator/rule-generator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RULE = 'no-helpers-to-views';
const slip = (name: string): string =>
  `import { v1 } from '../views/v1';\nexport const ${name} = v1;\n`;

describe('adopting a near-miss rule with --baseline', () => {
  let cwd: string;
  let repo: string;
  let log: ReturnType<typeof vi.spyOn>;
  const printed = (): string => log.mock.calls.flat().join('\n');
  const generate = (...args: string[]) =>
    buildProgram('9.9.9').parseAsync(['generate', '.', '--fast', ...args], { from: 'user' });
  const adopted = () => readAdoptedRules(path.join(repo, '.archprint'))!;
  const helpersSlip = (index: number): void =>
    writeFileSync(path.join(repo, 'helpers', `slip${index}.ts`), slip(`slip${index}`));

  beforeEach(() => {
    cwd = process.cwd();
    repo = mkdtempSync(path.join(tmpdir(), 'archprint-baseline-'));
    cpSync(path.join(here, '..', 'fixtures', 'layer-auto'), repo, { recursive: true });
    rmSync(path.join(repo, '.dependency-cruiser.json'));
    for (const index of [1, 2, 3, 4]) helpersSlip(index);
    process.chdir(repo);
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
    process.exitCode = 0;
  });

  const exceptions = [
    'helpers/slip1.ts',
    'helpers/slip2.ts',
    'helpers/slip3.ts',
    'helpers/slip4.ts',
  ];

  it('is below the gate, so --rules alone cannot adopt it', async () => {
    expect(scanRepo(repo).layerBoundaries.find((b) => b.from === 'helpers')!.gate.status).toBe(
      'SUGGEST',
    );
    await expect(generate('--include-structural', '--rules', RULE)).rejects.toThrow(
      `--rules names no rule this run would generate: ${RULE}`,
    );
  });

  it('adopts it with its current breaks recorded and exempt, and its evidence as measured', async () => {
    await generate('--include-structural', '--rules', RULE, '--baseline');
    const rule = adopted().find((candidate) => candidate.id === RULE)!;
    expect(rule.exceptions).toEqual(exceptions);
    expect(rule.evidence).toMatchObject({ conforming: 40, total: 44 });
    expect(rule.evidence.floor).toBeLessThan(0.9);
    const eslint = readFileSync(path.join(repo, '.archprint', 'eslint.mjs'), 'utf8');
    for (const file of exceptions) expect(eslint).toContain(`"${file}"`);
    expect(printed()).toContain(`Adopted with a baseline`);
    expect(printed()).toContain(`  ${RULE}: ${exceptions.join(', ')}`);
  });

  it('keeps it on a later plain run, and refuses a new break of it', async () => {
    await generate('--include-structural', '--rules', RULE, '--baseline');
    await generate();
    expect(adopted().map((rule) => rule.id)).toContain(RULE);
    helpersSlip(5);
    await expect(generate()).rejects.toThrow(`  ${RULE}: helpers/slip5.ts`);
  });

  it('accepts a new break of an adopted rule named again with --baseline, and lists it', async () => {
    await generate('--include-structural', '--rules', RULE, '--baseline');
    helpersSlip(5);
    log.mockClear();
    await generate('--include-structural', '--rules', RULE, '--baseline');
    expect(adopted().find((rule) => rule.id === RULE)!.exceptions).toContain('helpers/slip5.ts');
    expect(printed()).toContain('helpers/slip5.ts');
  });

  it('needs --rules', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await generate('--baseline');
    expect(error.mock.calls.flat().join(' ')).toContain(
      '--baseline adopts only the rules you name',
    );
    expect(process.exitCode).toBe(1);
  });
});

describe('rules that cannot be baselined, and how a baselined rule reads', () => {
  const scan = scanRepo(path.join(here, '..', 'fixtures', 'layer-auto'));
  const [boundary] = scan.layerBoundaries;

  it('refuses a rule the code does not follow (REJECT), naming it', () => {
    const rejected = {
      ...scan,
      layerBoundaries: [
        {
          ...boundary!,
          gate: evaluateGate({ roleFileCount: 44, violatingFileCount: 20, roleConfidence: 1 }),
        },
      ],
    };
    expect(rejected.layerBoundaries[0]!.gate.status).toBe('REJECT');
    expect(() => baselineRuleIds(rejected, [RULE])).toThrow(BaselineError);
    expect(() => baselineRuleIds(rejected, [RULE])).toThrow(`${RULE} cannot be adopted`);
  });

  it('promotes only the named SUGGEST rules, keeping the measured status', () => {
    const suggested = {
      ...scan,
      layerBoundaries: [
        {
          ...boundary!,
          gate: evaluateGate({ roleFileCount: 44, violatingFileCount: 4, roleConfidence: 1 }),
        },
      ],
    };
    const [promoted] = promoteBelowGate(suggested, new Set([RULE])).layerBoundaries;
    expect(promoted!.gate).toMatchObject({ status: 'AUTO', promotedFrom: 'SUGGEST' });
    expect(promoteBelowGate(suggested, new Set()).layerBoundaries[0]!.gate.status).toBe('SUGGEST');
  });

  it('tells a reader of the rule card that it was adopted below the gate', () => {
    const [pattern] = scanRepo(path.join(here, '..', 'fixtures', 'cli-auto')).patterns;
    const card = generateRuleArtifacts(pattern!.config, {
      ...pattern!.result,
      gate: { ...pattern!.result.gate, status: 'AUTO', promotedFrom: 'SUGGEST' },
    }).files.card;
    expect(card).toContain(
      'Status: **SUGGEST, below the gate and kept adopted with its current exceptions recorded**',
    );
  });
});
