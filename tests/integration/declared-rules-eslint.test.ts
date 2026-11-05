import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateRules } from '../../src/cli/check-evaluate.js';
import { declareFromMapping } from '../../src/cli/declared-adoption.js';
import type { DeclaredAdoptedRule } from '../../src/cli/adopted-rules.js';
import { emitLayout } from '../../src/cli/generate.js';
import { scanRepo } from '../../src/cli/scan.js';
import { eslintOnly, lintConfig } from './eslint-harness.js';
import { writeTree } from './layer-app.js';

const CLAUDE_MD = [
  '# Rules',
  '- Components never call fetch directly.',
  '- Components never read process.env.',
  '- Components must not import the data layer.',
  '- Do not use Next.js unstable_cache().',
  '- The web app must not reach into packages/mcds directly.',
  '- Do not add new primitives to src/ui.',
  '- The web app must not use the mcds primitives.',
].join('\n');

/** One app, with every way an import or a global read reaches a rule, and the cases neither side counts. */
const REPO: Record<string, string> = {
  'CLAUDE.md': CLAUDE_MD,
  'package.json': JSON.stringify({
    name: 'root',
    private: true,
    workspaces: ['apps/*', 'packages/*'],
  }),
  'apps/web/package.json': JSON.stringify({ name: '@acme/web' }),
  'apps/web/tsconfig.json': JSON.stringify({
    compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
  }),
  'apps/web/src/lib/db.ts': 'export const db = 1;\n',
  'apps/web/src/components/card.tsx': "export const Card = () => fetch('/x');\n",
  'apps/web/src/components/shadow.tsx': [
    "function load(fetch: (url: string) => void) { return fetch('/x'); }",
    "export const top = [load, fetch('/y')];",
  ].join('\n'),
  'apps/web/src/components/augment.ts': [
    'export {};',
    'declare global { var fetch: (url: string) => void; }',
    "fetch('/x');",
  ].join('\n'),
  'apps/web/src/components/env.ts': [
    'export const a = process.env.A;',
    "export const b = process['env'];",
    'export const c = process.argv;',
  ].join('\n'),
  'apps/web/src/components/types.ts': [
    "import type { db } from '@/lib/db';",
    'export type Db = typeof db;',
    'export type Fetch = typeof fetch;',
  ].join('\n'),
  'apps/web/src/components/list.tsx': "import { db } from '@/lib/db';\nexport const List = db;\n",
  'apps/web/src/components/reexport.ts':
    "export { db } from '../lib/db';\nexport * from '@/lib/db';\n",
  'apps/web/src/components/lazy.ts': "export const load = () => import('@/lib/db');\n",
  'apps/web/src/components/card.test.tsx':
    "import { db } from '@/lib/db';\nexport const t = [db, fetch('/t')];\n",
  'apps/web/src/cache/cache.ts':
    "import { unstable_cache } from 'next/cache';\nexport const c = unstable_cache;\n",
  'apps/web/src/cache/ns.ts': "import * as cache from 'next/cache';\nexport const c = cache;\n",
  'apps/web/src/cache/lazy.ts': "export const l = () => import('next/cache');\n",
  'apps/web/src/cache/other.ts':
    "import { revalidateTag } from 'next/cache';\nexport const r = revalidateTag;\n",
  'apps/web/src/cache/alias.ts': "export { unstable_cache as cached } from 'next/cache';\n",
  'apps/web/src/components/reads.tsx': [
    'export const handler = { fetch };',
    'export const named = { fetch: 1, [window.name]: 2 };',
    'export class Page extends window.HTMLElement {}',
    "export const button = <button onClick={() => fetch('/x')} />;",
    'export const tag = <window />;',
    "api.fetch('/y');",
    'export { fetch as request };',
  ].join('\n'),
  'apps/web/src/legacy.ts': [
    "import { Button } from '../../../packages/mcds/button';",
    "import { mcds } from '@acme/mcds';",
    "import { Badge } from '@acme/mcds/primitives/badge';",
    'export const x = [Button, mcds, Badge];',
  ].join('\n'),
  'apps/web/src/ui/button.tsx': 'export const Button = 1;\n',
  'apps/web/src/ui/button.test.tsx': "export const t = 'test';\n",
  'packages/mcds/package.json': JSON.stringify({
    name: '@acme/mcds',
    exports: { '.': './index.ts', './primitives/*': './src/primitives/*.tsx' },
  }),
  'packages/mcds/index.ts': 'export const mcds = 1;\n',
  'packages/mcds/button.tsx': 'export const Button = 1;\n',
  'packages/mcds/src/primitives/badge.tsx': 'export const Badge = 1;\n',
};

const quote = (text: string) => ({ file: 'CLAUDE.md', quote: text });
const COMPONENTS = ['apps/web/src/components/**'];

const MAPPING = {
  rules: [
    {
      template: 'forbid-usage',
      source: quote('Components never call fetch directly.'),
      name: 'no-fetch-in-components',
      files: COMPONENTS,
      usage: ['fetch'],
    },
    {
      template: 'forbid-usage',
      source: quote('Components never read process.env.'),
      name: 'no-env-in-components',
      files: COMPONENTS,
      usage: ['process.env'],
    },
    {
      template: 'forbid-import',
      source: quote('Components must not import the data layer.'),
      name: 'components-not-lib',
      files: COMPONENTS,
      targets: ['apps/web/src/lib/**'],
    },
    {
      template: 'forbid-import',
      source: quote('Do not use Next.js unstable_cache().'),
      name: 'no-unstable-cache',
      files: ['apps/web/src/**'],
      packages: [{ name: 'next/cache', imports: ['unstable_cache'] }],
    },
    {
      template: 'forbid-import',
      source: quote('The web app must not reach into packages/mcds directly.'),
      name: 'web-not-mcds',
      files: ['apps/web/src/legacy.ts'],
      targets: ['packages/mcds/**'],
    },
    {
      template: 'forbid-import',
      source: quote('The web app must not use the mcds primitives.'),
      name: 'web-not-primitives',
      files: ['apps/web/src/legacy.ts'],
      targets: ['packages/mcds/src/primitives/**'],
    },
    {
      template: 'forbid-file',
      source: quote('Do not add new primitives to src/ui.'),
      name: 'freeze-ui',
      files: ['apps/web/src/ui/**'],
    },
  ],
};

/** Every break, as `file:line rule`, the way both sides are compared. */
const EXPECTED = [
  'src/cache/alias.ts:1 doc-no-unstable-cache',
  'src/cache/cache.ts:1 doc-no-unstable-cache',
  'src/cache/ns.ts:1 doc-no-unstable-cache',
  'src/components/augment.ts:3 doc-no-fetch-in-components',
  'src/components/card.tsx:1 doc-no-fetch-in-components',
  'src/components/env.ts:1 doc-no-env-in-components',
  'src/components/env.ts:2 doc-no-env-in-components',
  'src/components/lazy.ts:1 doc-components-not-lib',
  'src/components/list.tsx:1 doc-components-not-lib',
  'src/components/reads.tsx:1 doc-no-fetch-in-components',
  'src/components/reads.tsx:4 doc-no-fetch-in-components',
  'src/components/reads.tsx:7 doc-no-fetch-in-components',
  'src/components/reexport.ts:1 doc-components-not-lib',
  'src/components/reexport.ts:2 doc-components-not-lib',
  'src/components/shadow.tsx:2 doc-no-fetch-in-components',
  'src/components/types.ts:3 doc-no-fetch-in-components',
  'src/legacy.ts:1 doc-web-not-mcds',
  'src/legacy.ts:2 doc-web-not-mcds',
  'src/legacy.ts:3 doc-web-not-mcds',
  'src/legacy.ts:3 doc-web-not-primitives',
  'src/ui/button.test.tsx:1 doc-freeze-ui',
  'src/ui/button.tsx:1 doc-freeze-ui',
];

describe('declared rules: the generated ESLint rules and archprint check agree', () => {
  let root: string;
  let appDir: string;
  let outDir: string;
  let rules: DeclaredAdoptedRule[];
  let eslint: ESLint;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-declared-e2e-')));
    writeTree(root, REPO);
    appDir = path.join(root, 'apps', 'web');
    outDir = path.join(root, '.archprint');
    const declaration = declareFromMapping(MAPPING, {
      root,
      appDir,
      rulesDir: outDir,
      baseline: true,
      allowedFor: () => [],
    });
    expect(declaration.refused).toEqual([]);
    rules = declaration.adopted.map((rule) => ({ ...rule, exceptions: [] }));
    emitLayout(scanRepo(appDir), outDir, {
      version: '9.9.9',
      enforcers: eslintOnly,
      declared: rules,
    });
    eslint = new ESLint({
      cwd: root,
      overrideConfigFile: lintConfig(root, './.archprint/eslint.mjs'),
    });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reports, in check, every break the fixture holds and nothing else', () => {
    const found = evaluateRules(appDir, rules, outDir).map(
      (finding) => `${finding.file}:${finding.line} ${finding.ruleId}`,
    );
    expect(found.sort()).toEqual(EXPECTED);
  });

  it('reports the same files and lines in ESLint', async () => {
    const results = await eslint.lintFiles(['apps/web/src/**/*.{ts,tsx}']);
    const reported = results.flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId?.startsWith('archprint/doc-'))
        .map(
          (message) =>
            `${path.relative(appDir, result.filePath)}:${message.line} ${message.ruleId!.slice('archprint/'.length)}`,
        ),
    );
    expect(reported.sort()).toEqual(EXPECTED);
  });

  it('words each ESLint error as the team wrote it, with its source line', async () => {
    const [result] = await eslint.lintFiles(['apps/web/src/components/card.tsx']);
    expect(result!.messages.map((message) => message.message)).toEqual([
      'Components never call fetch directly. (CLAUDE.md:2)',
    ]);
  });
});

describe('declared rules adopted with --baseline: ESLint skips exactly the recorded exceptions', () => {
  let root: string;
  let appDir: string;
  let outDir: string;
  let rules: DeclaredAdoptedRule[];
  let eslint: ESLint;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-declared-baseline-')));
    writeTree(root, REPO);
    appDir = path.join(root, 'apps', 'web');
    outDir = path.join(root, '.archprint');
    rules = declareFromMapping(MAPPING, {
      root,
      appDir,
      rulesDir: outDir,
      baseline: true,
      allowedFor: () => [],
    }).adopted;
    emitLayout(scanRepo(appDir), outDir, {
      version: '9.9.9',
      enforcers: eslintOnly,
      declared: rules,
    });
    eslint = new ESLint({
      cwd: root,
      overrideConfigFile: lintConfig(root, './.archprint/eslint.mjs'),
    });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const eslintHits = async (): Promise<string[]> =>
    (await eslint.lintFiles(['apps/web/src/**/*.{ts,tsx}']))
      .flatMap((result) =>
        result.messages
          .filter((message) => message.ruleId?.startsWith('archprint/doc-'))
          .map(
            (message) =>
              `${path.relative(appDir, result.filePath)}:${message.line} ${message.ruleId}`,
          ),
      )
      .sort();
  const newInCheck = (): string[] =>
    evaluateRules(appDir, rules, outDir)
      .filter(
        (finding) =>
          !rules.find((rule) => rule.id === finding.ruleId)!.exceptions!.includes(finding.file),
      )
      .map((finding) => `${finding.file}:${finding.line} archprint/${finding.ruleId}`)
      .sort();

  it('reports nothing on the day it is generated, as check finds nothing new', async () => {
    expect(rules.every((rule) => (rule.exceptions ?? []).length > 0)).toBe(true);
    expect(await eslintHits()).toEqual([]);
    expect(newInCheck()).toEqual([]);
  });

  it('reports a new break in both, and only that one', async () => {
    writeTree(root, {
      'apps/web/src/components/fresh.tsx': "export const Fresh = () => fetch('/new');\n",
      'apps/web/src/ui/input.tsx': 'export const Input = 1;\n',
    });
    const expected = [
      'src/components/fresh.tsx:1 archprint/doc-no-fetch-in-components',
      'src/ui/input.tsx:1 archprint/doc-freeze-ui',
    ];
    expect(await eslintHits()).toEqual(expected);
    expect(newInCheck()).toEqual(expected);
  });
});
