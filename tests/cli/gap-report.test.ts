import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildGapReport,
  type GapEntry,
  type GapReport,
  renderGapReport,
  restate,
} from '../../src/cli/gap-report.js';
import type { DeclaredRule } from '../../src/cli/declared-mapping.js';
import { writeTree } from '../integration/layer-app.js';

const CLAUDE_MD = [
  '# Rules',
  '- Never call fetch in a component.',
  '- Nothing reads localStorage directly.',
  '- packages/mcds must not import the app.',
  '- packages/mcds never fetches data itself.',
  '- Keep src/ui frozen: no new primitives.',
  '- Use the @/ alias for imports.',
  '- Prefer small pull requests.',
].join('\n');

const REPO: Record<string, string> = {
  'CLAUDE.md': CLAUDE_MD,
  'apps/web/tsconfig.json': JSON.stringify({
    compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
  }),
  'apps/web/src/app.ts': "export const app = fetch('/app');\n",
  'apps/web/src/components/card.tsx': "export const Card = fetch('/x');\n",
  'apps/web/src/components/list.tsx': "import { app } from '../app';\nexport const List = app;\n",
  'apps/web/src/ui/button.tsx': 'export const Button = 1;\n',
  'packages/mcds/button.tsx': 'export const B = 1;\n',
};

const quote = (text: string) => ({ file: 'CLAUDE.md', quote: text });

describe('buildGapReport', () => {
  let root: string;
  let report: GapReport;
  const entry = (id: string): GapEntry => report.entries.find((candidate) => candidate.id === id)!;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'archprint-gap-'));
    writeTree(root, REPO);
    report = buildGapReport(root, {
      rules: [
        {
          template: 'forbid-usage',
          source: quote('Never call fetch in a component.'),
          name: 'no-fetch-in-components',
          files: ['apps/web/src/components/**'],
          usage: ['fetch'],
        },
        {
          template: 'forbid-usage',
          source: quote('packages/mcds never fetches data itself.'),
          name: 'no-fetch-in-mcds',
          files: ['packages/mcds/**'],
          usage: ['fetch'],
        },
        {
          template: 'forbid-usage',
          source: quote('Nothing reads localStorage directly.'),
          name: 'no-local-storage',
          files: ['apps/**'],
          usage: ['localStorage'],
        },
        {
          template: 'forbid-import',
          source: quote('packages/mcds must not import the app.'),
          name: 'no-mcds-to-admin',
          files: ['packages/mcds/**'],
          targets: ['apps/admin/**'],
        },
        {
          template: 'forbid-import',
          source: quote('packages/mcds must not import the app.'),
          name: 'mcds-half-typo',
          files: ['apps/web/src/components/**'],
          targets: ['apps/web/src/app.ts', 'apps/admin/**'],
        },
        {
          template: 'forbid-usage',
          source: quote('Never call fetch in a component.'),
          name: 'typo-scope',
          files: ['apps/web/src/componentz/**'],
          usage: ['fetch'],
        },
        {
          template: 'forbid-file',
          source: quote('Keep src/ui frozen: no new primitives.'),
          name: 'freeze-ui',
          files: ['apps/web/src/ui/**'],
        },
        {
          template: 'forbid-file',
          source: quote('Keep src/ui frozen: no new primitives.'),
          name: 'freeze-typo',
          files: ['apps/web/src/uii/**'],
        },
        {
          template: 'forbid-usage',
          source: quote('Never call axios in a component.'),
          name: 'no-axios',
          files: ['apps/**'],
          usage: ['axios'],
        },
        {
          template: 'inferred',
          source: quote('Use the @/ alias for imports.'),
          rule: 'console-isolation',
        },
        {
          template: 'inferred',
          source: quote('Use the @/ alias for imports.'),
          rule: 'no-such-rule',
        },
        {
          template: 'none',
          source: quote('Prefer small pull requests.'),
          reason: 'a process rule',
        },
        { template: 'forbid-usage', source: quote('Prefer small pull requests.'), name: 'BAD' },
      ],
    });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('baselines a rule broken today, listing what breaks it, with the source line', () => {
    expect(entry('doc-no-fetch-in-components')).toMatchObject({
      status: 'baseline',
      source: { file: 'CLAUDE.md', line: 2 },
      mapped: 'files matching apps/web/src/components/** must not use the global fetch',
      evidence: { files: 2, following: 1, elsewhere: 1, vacuous: false },
      breaking: [{ file: 'apps/web/src/components/card.tsx', line: 1, subject: 'fetch' }],
    });
  });

  it('marks a followed rule to enforce now, and a rule nothing anywhere breaks as vacuous', () => {
    expect(entry('doc-no-fetch-in-mcds')).toMatchObject({
      status: 'enforce-now',
      evidence: { files: 1, following: 1, elsewhere: 2, vacuous: false },
    });
    expect(entry('doc-no-local-storage')).toMatchObject({
      status: 'enforce-now',
      evidence: { vacuous: true },
    });
  });

  it('sends a mapping that matches no file back to be checked, naming the glob', () => {
    expect(entry('doc-no-mcds-to-admin')).toMatchObject({
      status: 'no-match',
      reason: 'no source file matches apps/admin/**',
    });
    expect(entry('doc-typo-scope')).toMatchObject({
      status: 'no-match',
      reason: 'no source file matches apps/web/src/componentz/**',
    });
  });

  it('still lists what breaks a rule when one of its targets matches nothing', () => {
    expect(entry('doc-mcds-half-typo')).toMatchObject({
      status: 'no-match',
      reason: 'no source file matches apps/admin/**',
      breaking: [{ file: 'apps/web/src/components/list.tsx', line: 1, subject: '../app' }],
    });
  });

  it('enforces a frozen glob now, every file there today following it, and flags one that matches nothing', () => {
    expect(entry('doc-freeze-ui')).toMatchObject({
      status: 'enforce-now',
      evidence: { files: 1, following: 1, elsewhere: 0, vacuous: false },
    });
    expect(entry('doc-freeze-typo')).toMatchObject({
      status: 'enforce-now',
      evidence: { files: 0, vacuous: true },
    });
  });

  it('refuses a quote the file does not hold, keeping the id it would get', () => {
    expect(entry('doc-no-axios')).toMatchObject({
      status: 'quote-not-found',
      reason: 'the quote is not in CLAUDE.md',
    });
  });

  it('reports an inferred rule with its archprint evidence, and a rule archprint does not find', () => {
    const [found, missing] = report.entries.filter(
      (candidate) => candidate.template === 'inferred',
    );
    expect(found).toMatchObject({
      status: 'inferred',
      rule: { id: 'console-isolation', app: 'apps/web' },
    });
    expect(missing).toMatchObject({
      status: 'no-match',
      reason: expect.stringContaining('no rule "no-such-rule"'),
    });
  });

  it('keeps guidance and invalid entries, with their reasons', () => {
    expect(report.entries.at(-2)).toMatchObject({ status: 'guidance', reason: 'a process rule' });
    expect(report.entries.at(-1)).toMatchObject({
      status: 'invalid',
      reason: expect.stringContaining('"name" must be lowercase words'),
    });
  });

  it('refuses a directory with no tsconfig, before measuring anything', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'archprint-gap-empty-'));
    try {
      expect(() =>
        buildGapReport(empty, {
          rules: [{ template: 'none', source: quote('x'.repeat(12)), reason: 'r' }],
        }),
      ).toThrow('No tsconfig.json found');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('restate', () => {
  const base = { name: 'x', source: quote('a sentence here'), except: [] };

  it('words each template, listing alternatives with "or" and naming exceptions', () => {
    const rules: DeclaredRule[] = [
      {
        ...base,
        template: 'forbid-import',
        files: ['packages/mcds/**'],
        targets: ['apps/web/**'],
        packages: [{ name: 'lodash' }, { name: 'next/cache', imports: ['unstable_cache'] }],
      },
      {
        ...base,
        template: 'forbid-usage',
        files: ['src/**'],
        except: ['src/env.ts'],
        usage: ['process.env'],
      },
      { ...base, template: 'forbid-file', files: ['src/ui/**'] },
    ];
    expect(rules.map(restate)).toEqual([
      'files matching packages/mcds/** must not import apps/web/**, the package lodash or unstable_cache from next/cache',
      'files matching src/** (except src/env.ts) must not use the global process.env',
      'no new file may match src/ui/**',
    ]);
  });
});

describe('renderGapReport', () => {
  const breaking = Array.from({ length: 12 }, (_, index) => ({
    file: `src/components/c${index}.tsx`,
    line: 3,
    subject: 'fetch',
  }));
  const report: GapReport = {
    entries: [
      {
        status: 'baseline',
        source: { ...quote('Never call fetch in a component.'), line: 2 },
        template: 'forbid-usage',
        id: 'doc-no-fetch',
        mapped: 'files matching src/components/** must not use the global fetch',
        evidence: { files: 20, following: 8, elsewhere: 3, vacuous: false },
        breaking,
      },
      {
        status: 'enforce-now',
        source: { ...quote('Keep src/ui frozen: no new primitives.'), line: 5 },
        template: 'forbid-file',
        id: 'doc-freeze-ui',
        mapped: 'no new file may match src/ui/**',
        evidence: { files: 4, following: 4, elsewhere: 0, vacuous: false },
      },
      {
        status: 'enforce-now',
        source: { ...quote('Nothing reads localStorage directly.'), line: 3 },
        template: 'forbid-usage',
        id: 'doc-no-storage',
        mapped: 'files matching src/** must not use the global localStorage',
        evidence: { files: 9, following: 9, elsewhere: 0, vacuous: true },
      },
      {
        status: 'inferred',
        source: { ...quote('Use the @/ alias for imports.'), line: 6 },
        template: 'inferred',
        rule: {
          app: '.',
          id: 'import-style',
          statement: 'prefer workspace aliases over deep relative imports',
          status: 'AUTO',
          adoption: 'enforce',
          files: 40,
          following: 39,
        },
      },
      { status: 'invalid', source: null, reason: '"template" must be one of ...' },
      {
        status: 'guidance',
        source: { ...quote('Prefer small pull requests.'), line: 7 },
        template: 'none',
        reason: 'a process rule',
      },
    ],
  };
  const text = renderGapReport(report);

  it('opens with the count in each group', () => {
    expect(text.split('\n')[0]).toBe(
      'Gap report: 6 sentence(s) mapped. Enforce now: 2. Enforce with a baseline (broken today): 1. Already an archprint rule: 1. Check the mapping: 1. Guidance only: 1.',
    );
  });

  it('shows the quote, the mapping in words and the evidence, listing at most ten breaks', () => {
    expect(text).toContain(
      [
        '  doc-no-fetch  (CLAUDE.md:2)',
        '    "Never call fetch in a component."',
        '    Mapped as: files matching src/components/** must not use the global fetch.',
        '    8 of 20 file(s) follow it.',
        '    3 file(s) outside the scope do it.',
        '      src/components/c0.tsx:3  fetch',
      ].join('\n'),
    );
    expect(text).toContain('      src/components/c9.tsx:3  fetch\n      ... and 2 more');
    expect(text).not.toContain('c10.tsx');
  });

  it('says what a freeze and a vacuous rule do and do not prove', () => {
    expect(text).toContain(
      'Freezes the 4 file(s) there today. Not verified: whether any were added after the sentence was written.',
    );
    expect(text).toContain(
      'Nothing in the code does this, in scope or out: check the mapping names the right thing.',
    );
  });

  it('shows an inferred rule with its status, and the reason for invalid and guidance entries', () => {
    expect(text).toContain(
      '    archprint rule import-style (AUTO, enforce): prefer workspace aliases over deep relative imports.\n    39 of 40 file(s) follow it.',
    );
    expect(text).toContain(
      '  entry  (no source)\n    Not a valid mapping: "template" must be one of ....',
    );
    expect(text).toContain('  guidance  (CLAUDE.md:7)');
    expect(text).toContain('    Not checkable by a template: a process rule.');
  });
});
