import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { regenerateConfigs } from '../../src/cli/generate.js';
import { runEslintCheck } from '../../src/cli/program.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);
const eslintOnly = {
  eslint: true,
  eslintPluginImport: false,
  dependencyCruiser: false,
  biome: false,
};

describe('runEslintCheck', () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-check-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });
  const logged = (): string => logSpy.mock.calls.flat().join('\n');

  it('reports when there are no eslint rules to check', async () => {
    await runEslintCheck(fixture('console-isolation-auto'), path.join(dir, 'empty-out'));
    expect(logged()).toContain('no eslint rules were generated');
  });

  it('flags a repo that drifts from a generated rule after generation', async () => {
    const outDir = path.join(dir, 'out');
    regenerateConfigs(scanRepo(fixture('console-isolation-auto')), outDir, {
      version: '0',
      enforcers: eslintOnly,
    });
    const appDir = path.join(dir, 'app');
    cpSync(fixture('console-isolation-auto'), appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'src', 'leak.ts'),
      "export const f = () => console.log('drift');\n",
    );
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('violation');
    expect(process.exitCode).toBe(1);
  });

  it('does not flag a test file that logs (excluded from the scored population)', async () => {
    const outDir = path.join(dir, 'out');
    regenerateConfigs(scanRepo(fixture('console-isolation-auto')), outDir, {
      version: '0',
      enforcers: eslintOnly,
    });
    const appDir = path.join(dir, 'app');
    cpSync(fixture('console-isolation-auto'), appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'src', 'foo.test.ts'),
      "export const f = () => console.log('in a test');\n",
    );
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('pass clean');
  });
});
