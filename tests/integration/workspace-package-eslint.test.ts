import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wireEslintContent } from '../../src/cli/wiring.js';
import { detectWorkspacePackageApi } from '../../src/detector/workspace-package-detector.js';
import { renderEslintPreset } from '../../src/generator/eslint-preset-emitter.js';
import { toEslintWorkspacePackageApi } from '../../src/generator/workspace-package-emitters.js';
import { writeTree } from './layer-app.js';

const CONSUMERS = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => [
    `apps/web/src/screen-${String(index).padStart(2, '0')}.ts`,
    "import { ui } from '@acme/ui';\nexport const screen = ui;\n",
  ]),
);

/** A monorepo whose UI package exports a subpath, a pattern and a blocked folder, and a kit package without exports. */
const REPO: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'root',
    private: true,
    workspaces: ['apps/*', 'packages/*'],
  }),
  'apps/web/package.json': JSON.stringify({ name: '@acme/web' }),
  'apps/web/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
  ...CONSUMERS,
  'packages/ui/package.json': JSON.stringify({
    name: '@acme/ui',
    exports: {
      '.': './src/index.ts',
      './button': './src/button.ts',
      './icons/*': { types: './dist/icons/*.d.ts', default: './src/icons/*.ts' },
      './icons/internal/*': null,
    },
  }),
  'packages/ui/src/index.ts': 'export const ui = 1;\n',
  'packages/ui/src/button.ts': 'export const button = 1;\n',
  'packages/ui/src/icons/star.ts': 'export const star = 1;\n',
  'packages/ui/src/icons/internal/raw.ts': 'export const raw = 1;\n',
  'packages/kit/package.json': JSON.stringify({ name: '@acme/kit' }),
  'packages/kit/src/date.ts': 'export const date = 1;\n',
  'packages/open/package.json': JSON.stringify({
    name: '@acme/open',
    exports: { './*': './src/*.ts' },
  }),
  'packages/open/src/theme.ts': 'export const theme = 1;\n',
  'packages/gated/package.json': JSON.stringify({
    name: '@acme/gated',
    exports: { './*': './src/*.ts', './internal/*': null },
  }),
  'packages/gated/src/internal/key.ts': 'export const key = 1;\n',
};

const PROBES: Record<string, string> = {
  'apps/web/src/probe-button.ts':
    "import { button } from '@acme/ui/button';\nexport const p = button;\n",
  'apps/web/src/probe-icon.ts':
    "import { star } from '@acme/ui/icons/star';\nexport const p = star;\n",
  'apps/web/src/probe-blocked.ts':
    "import { raw } from '@acme/ui/icons/internal/raw';\nexport const p = raw;\n",
  'apps/web/src/probe-source.ts':
    "import { button } from '@acme/ui/src/button';\nexport const p = button;\n",
  'apps/web/src/probe-kit.ts':
    "import { date } from '@acme/kit/src/date';\nexport const p = date;\n",
  'apps/web/src/probe-open.ts':
    "import { theme } from '@acme/open/theme';\nexport const p = theme;\n",
  'apps/web/src/probe-gated.ts':
    "import { key } from '@acme/gated/internal/key';\nexport const p = key;\n",
};

const DEEP = [
  'src/probe-blocked.ts',
  'src/probe-gated.ts',
  'src/probe-kit.ts',
  'src/probe-source.ts',
];

describe('workspace-package rule: check and ESLint agree on exported subpaths (real ESLint)', () => {
  let root: string;
  let appDir: string;
  let eslint: ESLint;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-workspace-package-')));
    writeTree(root, REPO);
    appDir = path.join(root, 'apps', 'web');
    const analysis = detectWorkspacePackageApi(appDir);
    expect(analysis.gate.status).toBe('AUTO');
    const rule = toEslintWorkspacePackageApi(analysis);
    mkdirSync(path.join(appDir, '.archprint'));
    writeFileSync(path.join(appDir, '.archprint', 'eslint.mjs'), renderEslintPreset([], [rule!]));
    const config = `import tseslint from '${import.meta.resolve('typescript-eslint')}';\n\nexport default [\n  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },\n];\n`;
    writeFileSync(
      path.join(appDir, 'eslint.config.mjs'),
      wireEslintContent(config, './.archprint/eslint.mjs').content!,
    );
    writeTree(root, PROBES);
    eslint = new ESLint({ cwd: appDir });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reports, in check, only the imports past what each package exports', () => {
    const found = detectWorkspacePackageApi(appDir).violations.map((violation) => violation.file);
    expect(found).toEqual(DEEP);
  });

  it('counts no evidence from a package that exports every subpath, since nothing there can break the rule', () => {
    const screensAndProbes = 40 + Object.keys(PROBES).length - 1;
    expect(detectWorkspacePackageApi(appDir).consumerCount).toBe(screensAndProbes);
  });

  it('reports the same files in ESLint', async () => {
    const results = await eslint.lintFiles(['src/probe-*.ts']);
    const reported = results
      .filter((result) =>
        result.messages.some((message) => message.ruleId === 'archprint/workspace-package'),
      )
      .map((result) => path.relative(appDir, result.filePath))
      .sort();
    expect(reported).toEqual(DEEP);
  });
});
