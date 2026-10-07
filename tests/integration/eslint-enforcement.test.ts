import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { emitLayout } from '../../src/cli/generate.js';
import { renderEslintPluginSource } from '../../src/generator/eslint-plugin-emitter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'console-isolation-auto');
const eslintOnly = {
  eslint: true,
  eslintPluginImport: false,
  dependencyCruiser: false,
  biome: false,
};

describe('eslint enforcement (end to end)', () => {
  let tmp: string;
  let eslint: ESLint;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'archprint-e2e-'));
    const outDir = path.join(tmp, '.archprint');
    emitLayout(scanRepo(fixture), outDir, { version: '9.9.9', enforcers: eslintOnly });
    expect(existsSync(path.join(outDir, 'eslint.mjs'))).toBe(true);
    const configPath = path.join(tmp, 'eslint.config.mjs');
    writeFileSync(
      configPath,
      "import archprintRules from './.archprint/eslint.mjs';\nexport default [...archprintRules];\n",
    );
    eslint = new ESLint({ cwd: tmp, overrideConfigFile: configPath });
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reports a violation of the generated no-console rule', async () => {
    const [result] = await eslint.lintText("export const f = () => console.log('x');\n", {
      filePath: path.join(tmp, 'src', 'lib', 'thing.ts'),
    });
    const rules = result!.messages.map((m) => m.ruleId);
    expect(rules).toContain('no-console');
  });

  it('passes clean code that does not violate the rule', async () => {
    const [result] = await eslint.lintText('export const f = () => 1 + 1;\n', {
      filePath: path.join(tmp, 'src', 'lib', 'thing.ts'),
    });
    expect(result!.messages.filter((m) => m.ruleId === 'no-console')).toHaveLength(0);
  });
});

describe('generated eslint plugin (AP- rules, end to end)', () => {
  let tmp: string;
  let eslint: ESLint;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'archprint-plugin-e2e-'));
    const outDir = path.join(tmp, '.archprint');
    emitLayout(scanRepo(path.join(here, '..', 'fixtures', 'cli-auto')), outDir, {
      version: '9.9.9',
      enforcers: eslintOnly,
    });
    expect(existsSync(path.join(outDir, 'eslint.mjs'))).toBe(true);
    const configPath = path.join(tmp, 'eslint.config.mjs');
    writeFileSync(
      configPath,
      "import archprintRules from './.archprint/eslint.mjs';\nexport default [...archprintRules];\n",
    );
    eslint = new ESLint({ cwd: tmp, overrideConfigFile: configPath });
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('flags a server-entry route that imports the UI layer', async () => {
    const [result] = await eslint.lintText(
      "import C from '@/components/C1';\nexport const GET = () => C;\n",
      {
        filePath: path.join(tmp, 'app', 'api', 'x', 'route.ts'),
      },
    );
    expect(result!.messages.map((m) => m.ruleId)).toContain(
      'archprint/no-ui-layer-in-server-entry',
    );
  });

  it('passes a server-entry route that does not import the UI layer', async () => {
    const [result] = await eslint.lintText('export const GET = () => 1;\n', {
      filePath: path.join(tmp, 'app', 'api', 'x', 'route.ts'),
    });
    expect(
      result!.messages.filter((m) => m.ruleId === 'archprint/no-ui-layer-in-server-entry'),
    ).toHaveLength(0);
  });
});

describe('generated eslint plugin grandfathering (end to end)', () => {
  let tmp: string;
  let eslint: ESLint;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'archprint-grandfather-e2e-'));
    const spec = {
      name: 'no-forbidden',
      roles: ['app\\/api\\/.*\\/route\\.tsx?$'],
      markers: ['@/forbidden'],
      ignore: ['app/api/legacy/route.ts', 'app/api/[id]/(admin)/route.ts'],
      message: 'forbidden',
    };
    writeFileSync(path.join(tmp, 'eslint-plugin.archprint.mjs'), renderEslintPluginSource([spec]));
    const configPath = path.join(tmp, 'eslint.config.mjs');
    writeFileSync(
      configPath,
      "import plugin from './eslint-plugin.archprint.mjs';\nexport default plugin;\n",
    );
    eslint = new ESLint({ cwd: tmp, overrideConfigFile: configPath });
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const offending = "import x from '@/forbidden';\nexport const GET = () => x;\n";

  it('does not flag the grandfathered exception file', async () => {
    const [result] = await eslint.lintText(offending, {
      filePath: path.join(tmp, 'app', 'api', 'legacy', 'route.ts'),
    });
    expect(result!.messages.filter((m) => m.ruleId === 'archprint/no-forbidden')).toHaveLength(0);
  });

  it('does not flag an exception in a framework route folder, and flags the folder name read as a pattern', async () => {
    const lintAt = async (...segments: string[]) =>
      (
        await eslint.lintText(offending, { filePath: path.join(tmp, ...segments) })
      )[0]!.messages.filter((m) => m.ruleId === 'archprint/no-forbidden');
    expect(await lintAt('app', 'api', '[id]', '(admin)', 'route.ts')).toHaveLength(0);
    expect(await lintAt('app', 'api', 'i', 'admin', 'route.ts')).toHaveLength(1);
  });

  it('flags a file whose path only ends with the exception without being it', async () => {
    const [result] = await eslint.lintText(offending, {
      filePath: path.join(tmp, 'webapp', 'api', 'legacy', 'route.ts'),
    });
    expect(result!.messages.filter((m) => m.ruleId === 'archprint/no-forbidden')).toHaveLength(1);
  });

  it('flags the same violation in a new file', async () => {
    const [result] = await eslint.lintText(offending, {
      filePath: path.join(tmp, 'app', 'api', 'new', 'route.ts'),
    });
    expect(result!.messages.map((m) => m.ruleId)).toContain('archprint/no-forbidden');
  });
});
