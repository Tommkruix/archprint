import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAdoptedRules } from '../../src/cli/adopted-rules.js';
import { runAllow } from '../../src/cli/allow.js';
import { excludeAllowed } from '../../src/cli/allowed-evidence.js';
import { evaluateRules } from '../../src/cli/check-evaluate.js';
import { buildProgram } from '../../src/cli/program.js';
import { scanRepo } from '../../src/cli/scan.js';
import { dependencyApp } from './dependency-app.js';
import { writeTree } from './layer-app.js';

const PHANTOM = 'no-phantom-dependencies';
const SERVER_CLIENT = 'no-server-only-in-client';

describe('dependency rules through the CLI', () => {
  let cwd: string;
  let repo: string;
  const out = (...segments: string[]): string => path.join(repo, '.archprint', ...segments);
  const generate = (emit: string, ...args: string[]): Promise<unknown> =>
    buildProgram('9.9.9').parseAsync(['generate', '.', '--emit', emit, ...args], {
      from: 'user',
    });
  const allow = (rule: string, file: string): string =>
    runAllow({ cwd: repo, out: '.archprint', rule, file, reason: 'migrating' });

  beforeEach(() => {
    cwd = process.cwd();
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-dependency-cli-')));
    writeTree(repo, dependencyApp());
    process.chdir(repo);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  it('adopts both rules, so check reports a new break and allow exempts it in ESLint', async () => {
    await generate('eslint', '--include-structural');
    const adopted = readAdoptedRules(out())!;
    expect(adopted.map((rule) => rule.id)).toEqual(
      expect.arrayContaining([PHANTOM, SERVER_CLIENT]),
    );

    writeTree(repo, {
      'src/lib/new-phantom.ts': "import _ from 'lodash';\nexport const x = _;\n",
      'src/components/new-client.tsx':
        "'use client';\nimport { db } from '@/lib/db';\nexport const X = db;\n",
    });
    const files = (rule: string): string[] =>
      evaluateRules(repo, adopted)
        .filter((finding) => finding.ruleId === rule)
        .map((finding) => finding.file)
        .sort();
    expect(files(PHANTOM)).toEqual(['src/lib/legacy-phantom.ts', 'src/lib/new-phantom.ts']);
    expect(files(SERVER_CLIENT)).toEqual([
      'src/components/legacy-client.tsx',
      'src/components/new-client.tsx',
    ]);

    expect(allow(PHANTOM, 'src/lib/new-phantom.ts')).toContain('update the generated rules');
    allow(SERVER_CLIENT, 'src/components/new-client.tsx');
    await generate('eslint', '--include-structural');
    const eslint = readFileSync(out('eslint.mjs'), 'utf8');
    expect(eslint).toContain('"src/lib/new-phantom.ts"');
    expect(eslint).toContain('"src/components/new-client.tsx"');
  });

  it('writes both rules to dependency-cruiser instead when it enforces, with allowed files exempt', async () => {
    await generate('eslint', '--include-structural');
    writeTree(repo, { 'src/lib/new-phantom.ts': "import _ from 'lodash';\nexport const x = _;\n" });
    allow(PHANTOM, 'src/lib/new-phantom.ts');
    await generate('dependency-cruiser', '--include-structural');
    const depcruise = JSON.parse(readFileSync(out('dependency-cruiser.json'), 'utf8')) as {
      forbidden: { name: string; from: { pathNot: string[] } }[];
    };
    const names = depcruise.forbidden.map((rule) => rule.name);
    expect(names).toEqual(expect.arrayContaining([PHANTOM, SERVER_CLIENT]));
    const phantom = depcruise.forbidden.find((rule) => rule.name === PHANTOM)!;
    expect(phantom.from.pathNot).toContain('(^|/)src/lib/new-phantom\\.ts$');
    expect(readAdoptedRules(out())!.map((rule) => rule.id)).toEqual(
      expect.arrayContaining([PHANTOM, SERVER_CLIENT]),
    );
  });

  it('leaves an allowed phantom import out of the evidence', () => {
    writeFileSync(
      path.join(repo, 'src/lib/second-phantom.ts'),
      "import dayjs from 'dayjs';\nexport const d = dayjs;\n",
    );
    const scan = scanRepo(repo);
    expect(scan.phantomDependencies.offenderCount).toBe(2);
    const allowed = excludeAllowed(
      scan,
      new Map([[PHANTOM, ['src/lib/second-phantom.ts']]]),
    ).phantomDependencies;
    expect(allowed.offenderCount).toBe(1);
    expect(allowed.externalImporterCount).toBe(scan.phantomDependencies.externalImporterCount - 1);
  });

  it('leaves an allowed file out of the evidence, so the rule re-gates without it', () => {
    writeFileSync(
      path.join(repo, 'src/components/second-client.tsx'),
      "'use client';\nimport { db } from '@/lib/db';\nexport const Y = db;\n",
    );
    const scan = scanRepo(repo);
    expect(scan.serverClient.offenderCount).toBe(2);
    const allowed = excludeAllowed(
      scan,
      new Map([[SERVER_CLIENT, ['src/components/second-client.tsx']]]),
    ).serverClient;
    expect(allowed.offenderCount).toBe(1);
    expect(allowed.clientCount).toBe(scan.serverClient.clientCount - 1);
    expect(allowed.violations.map((violation) => violation.file)).toEqual([
      'src/components/legacy-client.tsx',
    ]);
  });
});
