import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitLayout } from '../../src/cli/generate.js';
import { scanRepo, type ScanResult } from '../../src/cli/scan.js';
import { detectDependencyInternals, detectPhantomDependencies } from '../../src/index.js';
import { eslintOnly, lintConfig, ruleHits } from './eslint-harness.js';
import { writeTree } from './layer-app.js';

const PHANTOM = 'archprint/no-phantom-dependencies';
const json = (value: unknown): string => JSON.stringify(value);

/** A SvelteKit app whose modules import SvelteKit's virtual modules and declared packages, and one undeclared. */
function svelteKitApp(kit: boolean): Record<string, string> {
  const files: Record<string, string> = {
    'package.json': json({
      name: 'web',
      devDependencies: { svelte: '5.0.0', ...(kit ? { '@sveltejs/kit': '2.0.0' } : {}) },
    }),
    'svelte.config.js': 'export default { kit: {} };\n',
    'tsconfig.json': json({ compilerOptions: { strict: true } }),
    'src/lib/legacy-phantom.ts': "import { debounce } from 'lodash';\nexport const d = debounce;\n",
    'src/lib/env.ts': "import { env } from '$env/dynamic/public';\nexport const e = env;\n",
  };
  for (let i = 0; i < 60; i += 1) {
    files[`src/lib/m${i}.ts`] =
      `import { page } from '$app/stores';\nimport { tick } from 'svelte';\nexport const m${i} = [page, tick];\n`;
  }
  return files;
}

describe('SvelteKit virtual modules', () => {
  let root: string;
  let plain: string;
  let scan: ScanResult;
  let eslint: ESLint;
  const at = (...segments: string[]): string => path.join(root, ...segments);

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-sveltekit-modules-')));
    plain = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-svelte-modules-')));
    writeTree(root, svelteKitApp(true));
    writeTree(plain, svelteKitApp(false));
    scan = scanRepo(root);
    emitLayout(scan, at('.archprint'), {
      version: '9.9.9',
      enforcers: eslintOnly,
      structural: true,
    });
    eslint = new ESLint({
      cwd: root,
      overrideConfigFile: lintConfig(root, './.archprint/eslint.mjs'),
    });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  });

  it('are not phantom dependencies of a SvelteKit app', () => {
    expect(scan.phantomDependencies.gate.status).toBe('AUTO');
    expect(scan.phantomDependencies.violations).toEqual([
      { file: 'src/lib/legacy-phantom.ts', specifier: 'lodash', package: 'lodash' },
    ]);
  });

  it('are packages to a Svelte app without SvelteKit', () => {
    expect(detectPhantomDependencies(plain).offenderCount).toBe(62);
  });

  it('are not package imports to the dependency-internals check', () => {
    expect(detectDependencyInternals(root).externalImporterCount).toBe(61);
  });

  it('pass the generated phantom-dependency rule, which still reports an undeclared package', async () => {
    const file = at('src', 'lib', 'new.ts');
    const allowed = [
      "import { goto } from '$app/navigation';\nexport const x = goto;\n",
      "import { PUBLIC_URL } from '$env/static/public';\nexport const x = PUBLIC_URL;\n",
      "import { build } from '$service-worker';\nexport const x = build;\n",
    ];
    for (const source of allowed) expect(await ruleHits(eslint, PHANTOM, source, file)).toBe(0);
    expect(
      await ruleHits(eslint, PHANTOM, "import _ from 'lodash';\nexport const x = _;\n", file),
    ).toBe(1);
  });
});
