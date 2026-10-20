import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitLayout } from '../../src/cli/generate.js';
import { layerRule } from '../../src/cli/adopted-rules.js';
import { evaluateRules } from '../../src/cli/check-evaluate.js';
import { scanRepo, type ScanResult } from '../../src/cli/scan.js';
import { eslintOnly, lintConfig, ruleHits as hits } from './eslint-harness.js';
import { nextApp, writeTree } from './layer-app.js';

const RULE = 'archprint/no-lib-to-app';
const ruleHits = (eslint: ESLint, source: string, filePath: string): Promise<number> =>
  hits(eslint, RULE, source, filePath);

describe('generated ESLint layer rules (end to end)', () => {
  let root: string;
  let eslint: ESLint;
  let configPath: string;
  let scan: ScanResult;
  const at = (...segments: string[]): string => path.join(root, ...segments);

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-layers-e2e-')));
    writeTree(root, {
      ...nextApp(),
      '.gitignore': 'src/lib/gen/\n',
      'src/lib/gen/routes.ts': "import { Page } from '../../app/page';\nexport const r = Page;\n",
    });
    scan = scanRepo(root);
    const boundary = scan.layerBoundaries.find((b) => b.from === 'lib' && b.to === 'app');
    expect(boundary?.gate.status).toBe('AUTO');
    expect(boundary?.violations.map((violation) => violation.file)).toEqual(['src/lib/legacy.ts']);
    emitLayout(scan, at('.archprint'), {
      version: '9.9.9',
      enforcers: eslintOnly,
      structural: true,
    });
    configPath = lintConfig(root, './.archprint/eslint.mjs');
    eslint = new ESLint({ cwd: root, overrideConfigFile: configPath });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes every file the scan read on the day it is generated', async () => {
    const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
    const hits = results.flatMap((result) =>
      result.messages.filter((message) => message.ruleId === RULE),
    );
    expect(results.length).toBeGreaterThan(100);
    expect(hits).toEqual([]);
  });

  it('flags a lib file importing the app layer by relative path at any depth, or by alias', async () => {
    const page = "import { Page } from '../app/page';\nexport const x = Page;\n";
    expect(await ruleHits(eslint, page, at('src', 'lib', 'new.ts'))).toBe(1);
    const deeper = "import { Page } from '../../app/page';\nexport const x = Page;\n";
    expect(await ruleHits(eslint, deeper, at('src', 'lib', 'db', 'new.ts'))).toBe(1);
    const alias = "import { Page } from '@/app/page';\nexport const x = Page;\n";
    expect(await ruleHits(eslint, alias, at('src', 'lib', 'new.ts'))).toBe(1);
  });

  it('flags side-effect and dynamic imports, which the scan counts as well', async () => {
    expect(await ruleHits(eslint, "import '@/app/page';\n", at('src', 'lib', 'new.ts'))).toBe(1);
    const dynamic = "export const load = () => import('@/app/page');\n";
    expect(await ruleHits(eslint, dynamic, at('src', 'lib', 'new.ts'))).toBe(1);
  });

  it('ignores type-only imports, which the scan does not count', async () => {
    const typeOnly = "import type { PageProps } from '@/app/page';\nexport type P = PageProps;\n";
    expect(await ruleHits(eslint, typeOnly, at('src', 'lib', 'new.ts'))).toBe(0);
    const inline = "import { type PageProps } from '@/app/page';\nexport type P = PageProps;\n";
    expect(await ruleHits(eslint, inline, at('src', 'lib', 'new.ts'))).toBe(0);
  });

  it('exempts the known exception and test files, and leaves the allowed direction alone', async () => {
    const page = "import { Page } from '../app/page';\nexport const x = Page;\n";
    expect(await ruleHits(eslint, page, at('src', 'lib', 'legacy.ts'))).toBe(0);
    expect(await ruleHits(eslint, page, at('src', 'lib', 'new.test.ts'))).toBe(0);
    const appToLib = "import { lib1 } from '@/lib/l1';\nexport const x = lib1;\n";
    expect(await ruleHits(eslint, appToLib, at('src', 'app', 'new', 'page.tsx'))).toBe(0);
  });

  it('skips the files the scan never reads: build output, dot-folders, ambient module blocks', async () => {
    const page = "import { Page } from '../../app/page';\nexport const x = Page;\n";
    expect(await ruleHits(eslint, page, at('src', 'lib', 'build', 'x.ts'))).toBe(0);
    expect(await ruleHits(eslint, page, at('src', 'lib', '.cache', 'x.ts'))).toBe(0);
    expect(await ruleHits(eslint, page, at('src', 'lib', 'types.d.ts'))).toBe(0);
    const ambient =
      "declare module 'x' {\n  import { Page } from '@/app/page';\n  export const p: typeof Page;\n}\n";
    expect(await ruleHits(eslint, ambient, at('src', 'lib', 'ambient.ts'))).toBe(0);
    const control = "import { Page } from '../../app/page';\nexport const x = Page;\n";
    expect(await ruleHits(eslint, control, at('src', 'lib', 'db', 'x.ts'))).toBe(1);
  });

  it('reads a lib folder inside a route as the app layer, and packages as no layer', async () => {
    const alias = "import { Page } from '@/app/page';\nexport const x = Page;\n";
    expect(await ruleHits(eslint, alias, at('src', 'app', '(dash)', 'lib', 'h.ts'))).toBe(0);
    const pkg = "import { app } from 'app';\nexport const x = app;\n";
    expect(await ruleHits(eslint, pkg, at('src', 'lib', 'new.ts'))).toBe(0);
  });

  it('enforces a file reached through a symlinked folder', async () => {
    const link = `${root}-link`;
    symlinkSync(root, link);
    try {
      writeFileSync(
        at('src', 'lib', 'linked.ts'),
        "import { Page } from '../app/page';\nexport const x = Page;\n",
      );
      const viaLink = new ESLint({
        cwd: link,
        overrideConfigFile: path.join(link, 'eslint.config.mjs'),
      });
      const [result] = await viaLink.lintFiles([path.join(link, 'src', 'lib', 'linked.ts')]);
      expect(result!.messages.filter((message) => message.ruleId === RULE)).toHaveLength(1);
      const unsaved = path.join(link, 'src', 'lib', 'unsaved.ts');
      expect(await ruleHits(viaLink, "import { Page } from '../app/page';\n", unsaved)).toBe(1);
    } finally {
      rmSync(at('src', 'lib', 'linked.ts'), { force: true });
      rmSync(link, { force: true });
    }
  });

  it('reports exactly the files archprint check reports, on the same imports', async () => {
    const leak = "import { Page } from '@/app/page';\nexport const x = Page;\n";
    const probes: Record<string, string> = {
      'src/lib/probe/relative.ts':
        "import { Page } from '../../app/page';\nexport const x = Page;\n",
      'src/lib/probe/alias.ts': leak,
      'src/lib/probe/dynamic.ts': "export const load = () => import('@/app/page');\n",
      'src/lib/probe/side-effect.ts': "import '@/app/page';\n",
      'src/lib/probe/type-only.ts':
        "import type { PageProps } from '@/app/page';\nexport type P = PageProps;\n",
      'src/lib/probe/inline-type.ts':
        "import { type PageProps } from '@/app/page';\nexport type P = PageProps;\n",
      'src/lib/probe/probe.test.ts': leak,
      'src/lib/probe/build/out.ts': leak,
      'src/lib/probe/.cache/out.ts': leak,
      'src/lib/probe/ambient.ts':
        "declare module 'x' {\n  import { Page } from '@/app/page';\n  export const p: typeof Page;\n}\n",
      'src/lib/probe/package.ts': "import { app } from 'app';\nexport const x = app;\n",
      'src/app/(dash)/lib/probe.ts': leak,
    };
    writeTree(root, probes);
    try {
      const boundary = scan.layerBoundaries.find((b) => b.from === 'lib' && b.to === 'app')!;
      const checked = evaluateRules(root, [layerRule(boundary)]).map((finding) => finding.file);
      const linted = (await eslint.lintFiles(['src/**/*.{ts,tsx}']))
        .filter((result) => result.messages.some((message) => message.ruleId === RULE))
        .map((result) => path.relative(root, result.filePath).split(path.sep).join('/'));
      expect(linted.sort()).toEqual(checked.filter((file) => file !== 'src/lib/legacy.ts').sort());
      expect(linted.sort()).toEqual([
        'src/lib/probe/alias.ts',
        'src/lib/probe/dynamic.ts',
        'src/lib/probe/relative.ts',
        'src/lib/probe/side-effect.ts',
      ]);
    } finally {
      rmSync(at('src', 'lib', 'probe'), { recursive: true, force: true });
      rmSync(at('src', 'app', '(dash)'), { recursive: true, force: true });
    }
  });

  it('leaves a gitignored folder alone, as the scan does', async () => {
    const page = "import { Page } from '../../app/page';\nexport const x = Page;\n";
    expect(await ruleHits(eslint, page, at('src', 'lib', 'gen', 'routes.ts'))).toBe(0);
    expect(await ruleHits(eslint, page, at('src', 'lib', 'generated', 'routes.ts'))).toBe(1);
  });

  it('does not lint a folder symlinked in from outside the app as part of it', async () => {
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-outside-')));
    try {
      writeFileSync(
        path.join(outside, 's.ts'),
        "import { Page } from '../../app/page';\nexport const x = Page;\n",
      );
      symlinkSync(outside, at('src', 'lib', 'shared'));
      const [result] = await eslint.lintFiles([at('src', 'lib', 'shared', 's.ts')]);
      expect(result!.messages.filter((message) => message.ruleId === RULE)).toHaveLength(0);
    } finally {
      rmSync(at('src', 'lib', 'shared'), { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('locates the app from the generated file, not from where eslint runs', async () => {
    const fromSubfolder = new ESLint({ cwd: at('src'), overrideConfigFile: configPath });
    const page = "import { Page } from '../app/page';\nexport const x = Page;\n";
    expect(await ruleHits(fromSubfolder, page, at('src', 'lib', 'new.ts'))).toBe(1);
  });
});

describe('generated ESLint layer rules in a monorepo app (end to end)', () => {
  let root: string;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-layers-mono-')));
    writeTree(path.join(root, 'apps', 'web'), nextApp());
    emitLayout(scanRepo(path.join(root, 'apps', 'web')), path.join(root, '.archprint'), {
      version: '9.9.9',
      enforcers: eslintOnly,
      structural: true,
      appPath: 'apps/web',
    });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('enforces the boundary inside the app and nowhere else in the repository', async () => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: lintConfig(root, './.archprint/eslint.mjs'),
    });
    const page = "import { Page } from '../app/page';\nexport const x = Page;\n";
    expect(await ruleHits(eslint, page, path.join(root, 'apps', 'web', 'src', 'lib', 'n.ts'))).toBe(
      1,
    );
    expect(
      await ruleHits(eslint, page, path.join(root, 'apps', 'web', 'src', 'lib', 'legacy.ts')),
    ).toBe(0);
    expect(await ruleHits(eslint, page, path.join(root, 'src', 'lib', 'n.ts'))).toBe(0);
  });
});
