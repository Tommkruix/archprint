import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptedAllowances, excludeAllowed } from '../../src/cli/allowed-evidence.js';
import { type DeclaredAdoptedRule, readAdoptedRules } from '../../src/cli/adopted-rules.js';
import { runAllow } from '../../src/cli/allow.js';
import { writeLayout, type WriteLayoutOptions } from '../../src/cli/layout.js';
import { buildProgram } from '../../src/cli/program.js';
import { NewViolationsError } from '../../src/cli/ratchet.js';
import { buildRecommendations } from '../../src/cli/recommend.js';
import { scanRepo } from '../../src/cli/scan.js';
import { eslintOnly } from '../integration/eslint-harness.js';
import { writeTree } from '../integration/layer-app.js';

const CLAUDE_MD = [
  '# Rules',
  '- Components never call fetch directly.',
  '- Do not add new primitives to src/ui.',
].join('\n');

const FETCH = "export const Card = () => fetch('/x');\n";
const quote = (text: string) => ({ file: 'CLAUDE.md', quote: text });

const NO_FETCH = {
  template: 'forbid-usage',
  source: quote('Components never call fetch directly.'),
  name: 'no-fetch-in-components',
  files: ['src/components/**'],
  usage: ['fetch'],
};
const FREEZE_UI = {
  template: 'forbid-file',
  source: quote('Do not add new primitives to src/ui.'),
  name: 'freeze-ui',
  files: ['src/ui/**'],
};
const MAPPING = {
  rules: [
    NO_FETCH,
    FREEZE_UI,
    {
      template: 'forbid-usage',
      source: quote('Never call axios from a page.'),
      name: 'no-axios',
      files: ['src/**'],
      usage: ['axios'],
    },
  ],
};

describe('declared rules: adopted with generate --declare, then kept by the ratchet', () => {
  let repo: string;
  let outDir: string;
  beforeEach(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-declared-')));
    writeTree(repo, {
      'CLAUDE.md': CLAUDE_MD,
      'tsconfig.json': '{}\n',
      'src/components/card.tsx': FETCH,
      'src/components/list.tsx': 'export const List = 1;\n',
      'src/ui/button.tsx': 'export const Button = 1;\n',
    });
    outDir = path.join(repo, '.archprint');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const write = (options: Partial<WriteLayoutOptions> = {}) => {
    const scan = excludeAllowed(scanRepo(repo), adoptedAllowances(outDir));
    return writeLayout(scan, outDir, {
      enforcers: eslintOnly,
      mode: 'fast',
      version: '9.9.9',
      recommendations: buildRecommendations(scan, new Set(), eslintOnly),
      app: '.',
      cwd: repo,
      ...options,
    });
  };
  const declared = (): DeclaredAdoptedRule[] =>
    (readAdoptedRules(outDir) ?? []).filter(
      (rule): rule is DeclaredAdoptedRule => rule.family === 'declared',
    );
  const put = (file: string, source: string): void => writeFileSync(path.join(repo, file), source);

  it('adopts what the code follows, and refuses a broken rule without --baseline and a quote not in the file', () => {
    const result = write({ declare: MAPPING });
    expect(result.declared.adopted.map((rule) => rule.id)).toEqual(['doc-freeze-ui']);
    expect(result.declared.refused).toEqual([
      {
        label: 'doc-no-fetch-in-components',
        quote: NO_FETCH.source.quote,
        reason: 'the code breaks it today; adopt it with --baseline to record the breaks',
      },
      {
        label: 'doc-no-axios',
        quote: 'Never call axios from a page.',
        reason: 'the quote is not in CLAUDE.md',
      },
    ]);
    expect(declared()).toEqual([
      expect.objectContaining({
        id: 'doc-freeze-ui',
        family: 'declared',
        template: 'forbid-file',
        statement: FREEZE_UI.source.quote,
        root: '..',
        source: { file: 'CLAUDE.md', line: 3 },
        evidence: { conforming: 1, total: 1, floor: expect.any(Number) },
        exceptions: ['src/ui/button.tsx'],
      }),
    ]);
    expect(readFileSync(path.join(outDir, 'eslint.mjs'), 'utf8')).toContain('"doc-freeze-ui"');
  });

  it('refuses an inferred and a guidance sentence by their labels, pointing the first at --rules', () => {
    const result = write({
      declare: {
        rules: [
          { template: 'inferred', source: NO_FETCH.source, rule: 'no-cycles' },
          { template: 'none', source: FREEZE_UI.source, reason: 'a process rule' },
        ],
      },
    });
    expect(result.declared.refused).toEqual([
      {
        label: 'no-cycles',
        quote: NO_FETCH.source.quote,
        reason: 'already an archprint rule: adopt it with --rules no-cycles',
      },
      { label: 'guidance', quote: FREEZE_UI.source.quote, reason: 'guidance only: a process rule' },
    ]);
  });

  it('adopts a broken rule with --baseline, recording what breaks it today', () => {
    const result = write({ declare: MAPPING, baseline: true });
    expect(result.declared.adopted.map((rule) => [rule.id, rule.exceptions])).toEqual([
      ['doc-no-fetch-in-components', ['src/components/card.tsx']],
      ['doc-freeze-ui', ['src/ui/button.tsx']],
    ]);
    expect(declared().find((rule) => rule.id === 'doc-no-fetch-in-components')?.evidence).toEqual({
      conforming: 1,
      total: 2,
      floor: expect.any(Number),
    });
  });

  it('keeps declared rules on a plain generate, which rebuilds the inferred rules from the scan', () => {
    write({ declare: MAPPING, baseline: true });
    const result = write();
    expect(result.declared.kept).toEqual(['doc-freeze-ui', 'doc-no-fetch-in-components']);
    expect(declared().map((rule) => rule.id)).toEqual([
      'doc-freeze-ui',
      'doc-no-fetch-in-components',
    ]);
  });

  it('refuses a new break and a new file in a frozen folder, naming each, and writes nothing', () => {
    write({ declare: MAPPING, baseline: true });
    put('src/components/list.tsx', FETCH);
    put('src/ui/input.tsx', 'export const Input = 1;\n');
    const before = readFileSync(path.join(outDir, 'config.json'), 'utf8');
    expect(() => write()).toThrow(NewViolationsError);
    try {
      write();
    } catch (error) {
      expect((error as NewViolationsError).broken).toEqual([
        { rule: 'doc-freeze-ui', exceptions: ['src/ui/input.tsx'] },
        { rule: 'doc-no-fetch-in-components', exceptions: ['src/components/list.tsx'] },
      ]);
    }
    expect(readFileSync(path.join(outDir, 'config.json'), 'utf8')).toBe(before);
  });

  it('drops a fixed exception and lists it, so the rule applies to that file from then on', () => {
    write({ declare: MAPPING, baseline: true });
    put('src/components/card.tsx', 'export const Card = 1;\n');
    const result = write();
    expect(result.fixed).toEqual([
      { rule: 'doc-no-fetch-in-components', exceptions: ['src/components/card.tsx'] },
    ]);
    expect(declared().find((rule) => rule.id === 'doc-no-fetch-in-components')?.exceptions).toEqual(
      [],
    );
  });

  it('accepts a break allowed with a reason', () => {
    write({ declare: MAPPING, baseline: true });
    put('src/components/list.tsx', FETCH);
    runAllow({
      cwd: repo,
      out: '.archprint',
      rule: 'doc-no-fetch-in-components',
      file: 'src/components/list.tsx',
      reason: 'migrating it next sprint',
    });
    expect(() => write()).not.toThrow();
  });

  it('follows the sentence when it moves, and keeps the rule, said so, when it is gone', () => {
    write({ declare: MAPPING, baseline: true });
    put('CLAUDE.md', ['# Rules', '', '', '- Components never call fetch directly.'].join('\n'));
    const result = write();
    expect(declared().find((rule) => rule.id === 'doc-no-fetch-in-components')?.source).toEqual({
      file: 'CLAUDE.md',
      line: 4,
    });
    expect(result.declared.stale.map((rule) => rule.id)).toEqual(['doc-freeze-ui']);
    expect(declared().map((rule) => rule.id)).toContain('doc-freeze-ui');
  });

  it('removes declared rules with --reset, and lists them', () => {
    write({ declare: MAPPING, baseline: true });
    const result = write({ reset: true });
    expect(result.reset).toEqual(
      expect.arrayContaining(['doc-freeze-ui', 'doc-no-fetch-in-components']),
    );
    expect(declared()).toEqual([]);
  });

  it('replaces a rule declared again under the same name with its new definition', () => {
    write({ declare: MAPPING, baseline: true });
    const narrower = { ...NO_FETCH, files: ['src/components/list.tsx'] };
    const result = write({ declare: { rules: [narrower] } });
    expect(result.declared.adopted.map((rule) => rule.id)).toEqual(['doc-no-fetch-in-components']);
    expect(result.declared.replaced).toEqual(['doc-no-fetch-in-components']);
    expect(declared().find((rule) => rule.id === 'doc-no-fetch-in-components')).toMatchObject({
      files: ['src/components/list.tsx'],
      exceptions: [],
    });
  });

  it('refuses a glob that matches no file, and a rule whose files are in another app', () => {
    const typo = write({ declare: { rules: [{ ...NO_FETCH, files: ['lib/**'] }] } });
    expect(typo.declared.refused).toEqual([
      expect.objectContaining({ reason: 'no source file matches lib/**' }),
    ]);
    writeTree(repo, {
      'apps/web/tsconfig.json': '{}\n',
      'apps/web/src/page.tsx': 'export const Page = 1;\n',
      'packages/kit/fetcher.ts': "export const get = () => fetch('/x');\n",
    });
    const appDir = path.join(repo, 'apps', 'web');
    const scan = scanRepo(appDir);
    const result = writeLayout(scan, outDir, {
      enforcers: eslintOnly,
      mode: 'fast',
      version: '9.9.9',
      recommendations: buildRecommendations(scan, new Set(), eslintOnly),
      app: 'apps/web',
      cwd: repo,
      baseline: true,
      declare: { rules: [{ ...NO_FETCH, name: 'kit-no-fetch', files: ['packages/kit/**'] }] },
    });
    expect(result.declared.refused).toEqual([
      {
        label: 'doc-kit-no-fetch',
        quote: NO_FETCH.source.quote,
        reason:
          'no file of apps/web matches packages/kit/**; adopt it from the app that holds them',
      },
    ]);
  });
});

describe('archprint generate --declare', () => {
  let repo: string;
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const output = (): string =>
    logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');

  beforeEach(() => {
    cwd = process.cwd();
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-declare-cli-')));
    writeTree(repo, {
      'CLAUDE.md': CLAUDE_MD,
      'tsconfig.json': '{}\n',
      'eslint.config.mjs': 'export default [];\n',
      'package.json': JSON.stringify({ devDependencies: { eslint: '9.0.0' } }),
      'src/components/card.tsx': FETCH,
      'src/ui/button.tsx': 'export const Button = 1;\n',
      'mapping.json': JSON.stringify(MAPPING),
    });
    process.chdir(repo);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  });

  it('lists what it adopted with the evidence, and what it did not with the reason', async () => {
    await buildProgram('9.9.9').parseAsync(
      ['generate', '.', '--declare', 'mapping.json', '--fast'],
      {
        from: 'user',
      },
    );
    expect(output()).toContain(
      [
        'Adopted 1 rule(s) your context files state:',
        '  doc-freeze-ui  "Do not add new primitives to src/ui." (CLAUDE.md:3)',
        '    freezes the 1 file(s) there today; a new one breaks it',
        'Not adopted (2):',
        '  doc-no-fetch-in-components "Components never call fetch directly.": the code breaks it today; adopt it with --baseline to record the breaks',
        '  doc-no-axios "Never call axios from a page.": the quote is not in CLAUDE.md',
      ].join('\n'),
    );
  });
});
