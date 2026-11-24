import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { emitLayout } from '../../src/cli/generate.js';
import { runEslintCheck } from '../../src/cli/eslint-check.js';
import { writeLayout } from '../../src/cli/layout.js';
import { buildRecommendations } from '../../src/cli/recommend.js';
import { writeTree } from '../integration/layer-app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);
const installed = path.join(here, '..', '..', 'node_modules');
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

  /** The console-isolation fixture with its rules generated and the given packages (default: all) installed. */
  const generatedApp = (packages?: string[]): { appDir: string; outDir: string } => {
    const appDir = path.join(dir, 'app');
    cpSync(fixture('console-isolation-auto'), appDir, { recursive: true });
    if (packages === undefined) {
      symlinkSync(installed, path.join(appDir, 'node_modules'), 'dir');
    } else {
      for (const name of packages) {
        mkdirSync(path.dirname(path.join(appDir, 'node_modules', name)), { recursive: true });
        symlinkSync(path.join(installed, name), path.join(appDir, 'node_modules', name), 'dir');
      }
    }
    const outDir = path.join(appDir, '.archprint');
    emitLayout(scanRepo(appDir), outDir, { version: '9.9.9', enforcers: eslintOnly });
    return { appDir, outDir };
  };
  const eslintConfig = (appDir: string, blocks: string, imports = ''): void =>
    writeFileSync(
      path.join(appDir, 'eslint.config.mjs'),
      `import tseslint from 'typescript-eslint';\n${imports}` +
        `export default [{ files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } }${blocks}];\n`,
    );
  const wire = (appDir: string, after = ''): void =>
    eslintConfig(
      appDir,
      `, ...archprint${after}`,
      "import archprint from './.archprint/eslint.mjs';\n",
    );

  it('reports when there are no eslint rules to check', async () => {
    await runEslintCheck(fixture('console-isolation-auto'), path.join(dir, 'empty-out'));
    expect(logged()).toContain('no eslint rules were generated');
  });

  it('flags a repo that drifts from a generated rule after generation', async () => {
    const { appDir, outDir } = generatedApp();
    writeFileSync(
      path.join(appDir, 'src', 'leak.ts'),
      "export const f = () => console.log('drift');\n",
    );
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('violation');
    expect(process.exitCode).toBe(1);
  });

  it('reports files that could not be parsed instead of passing them clean', async () => {
    const { appDir, outDir } = generatedApp();
    writeFileSync(path.join(appDir, 'src', 'broken.ts'), 'export const x = (;\n');
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('could not be parsed');
    expect(process.exitCode).toBe(1);
  });

  it('does not flag a test file that logs (excluded from the scored population)', async () => {
    const { appDir, outDir } = generatedApp();
    writeFileSync(
      path.join(appDir, 'src', 'foo.test.ts'),
      "export const f = () => console.log('in a test');\n",
    );
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('pass clean');
  });

  it('checks the rules on their own, and says so, before they are wired', async () => {
    const { appDir, outDir } = generatedApp();
    eslintConfig(appDir, '');
    await runEslintCheck(appDir, outDir);
    expect(logged()).not.toContain('could not load');
    expect(logged()).toContain(
      'does not load eslint.mjs yet, so its rules are checked on their own',
    );
    expect(logged()).toContain('pass clean');
    expect(process.exitCode).toBe(0);
  });

  it("lints through the repo's own config once wired", async () => {
    const { appDir, outDir } = generatedApp();
    wire(appDir);
    writeFileSync(
      path.join(appDir, 'src', 'leak.ts'),
      "export const f = () => console.log('drift');\n",
    );
    await runEslintCheck(appDir, outDir);
    expect(logged()).not.toContain('checked on their own');
    expect(logged()).toContain('src/leak.ts: archprint/console-isolation');
    expect(process.exitCode).toBe(1);
  });

  it("names a generated rule the repo's config turns off for some files", async () => {
    const { appDir, outDir } = generatedApp();
    for (const folder of ['legacy', 'generated']) mkdirSync(path.join(appDir, 'src', folder));
    for (const file of ['legacy/a.ts', 'legacy/b.ts', 'generated/c.ts', 'd.test.ts'])
      writeFileSync(path.join(appDir, 'src', file), 'export const x = 1;\n');
    wire(
      appDir,
      `, { files: ['src/legacy/**'], rules: { 'archprint/console-isolation': 'off' } }, { ignores: ['src/generated/**'] }`,
    );
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain(
      'archprint/console-isolation: not active for 2 file(s), e.g. src/legacy/a.ts',
    );
    expect(process.exitCode).toBe(1);
  });

  it('checks the rules on their own with @typescript-eslint/parser when that is the parser installed', async () => {
    const { appDir, outDir } = generatedApp(['eslint', '@typescript-eslint/parser']);
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('checked on their own');
    expect(logged()).toContain('pass clean');
  });

  it('cannot check unwired rules, and exits 2, without a TypeScript parser installed', async () => {
    const { appDir, outDir } = generatedApp(['eslint']);
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('no TypeScript parser');
    expect(process.exitCode).toBe(2);
  });

  it("stops with exit 2, and says why, when the repo's ESLint config cannot load", async () => {
    const { appDir, outDir } = generatedApp();
    writeFileSync(path.join(appDir, 'eslint.config.mjs'), "throw new Error('broken config');\n");
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('could not load your ESLint config');
    expect(logged()).toContain('broken config');
    expect(logged()).not.toContain('pass clean');
    expect(process.exitCode).toBe(2);
  });

  it('checks the rules on their own when the repo has no ESLint config file', async () => {
    const { appDir, outDir } = generatedApp();
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('does not load eslint.mjs yet');
    expect(logged()).toContain('pass clean');
  });

  it('counts a rule the repo downgrades to a warning as wired, and names it as not in force', async () => {
    const { appDir, outDir } = generatedApp();
    wire(appDir, `, { rules: { 'archprint/console-isolation': 'warn' } }`);
    await runEslintCheck(appDir, outDir);
    expect(logged()).not.toContain('checked on their own');
    expect(logged()).toContain('downgraded to a warning');
    expect(logged()).toMatch(/archprint\/console-isolation: not active for \d+ file\(s\)/);
    expect(process.exitCode).toBe(1);
  });

  it('cannot check, and exits 2, when the repo has no eslint installed', async () => {
    const appDir = path.join(dir, 'app');
    cpSync(fixture('console-isolation-auto'), appDir, { recursive: true });
    const outDir = path.join(appDir, '.archprint');
    emitLayout(scanRepo(appDir), outDir, { version: '9.9.9', enforcers: eslintOnly });
    await runEslintCheck(appDir, outDir);
    expect(logged()).toContain('--check needs ESLint 9 or later installed in');
    expect(process.exitCode).toBe(2);
  });

  describe('a declared rule, which applies only to the files its sentence names', () => {
    const NO_FETCH = 'archprint/doc-no-fetch-in-components';
    /** An app with "Components never call fetch directly." adopted, and production and test files in and out of it. */
    const declaredApp = (): { appDir: string; outDir: string } => {
      const appDir = path.join(dir, 'declared');
      writeTree(appDir, {
        'CLAUDE.md': '# Rules\n- Components never call fetch directly.\n',
        'tsconfig.json': '{}\n',
        'src/components/card.tsx': 'export const Card = 1;\n',
        'src/components/ui/button.tsx': 'export const Button = 1;\n',
        'src/components/ui/button.test.tsx': "export const t = fetch('/t');\n",
        'src/lib/api.ts': "export const load = () => fetch('/x');\n",
      });
      symlinkSync(installed, path.join(appDir, 'node_modules'), 'dir');
      const outDir = path.join(appDir, '.archprint');
      const scan = scanRepo(appDir);
      writeLayout(scan, outDir, {
        enforcers: eslintOnly,
        mode: 'fast',
        version: '9.9.9',
        recommendations: buildRecommendations(scan, new Set(), eslintOnly),
        app: '.',
        cwd: appDir,
        declare: {
          rules: [
            {
              template: 'forbid-usage',
              source: { file: 'CLAUDE.md', quote: 'Components never call fetch directly.' },
              name: 'no-fetch-in-components',
              files: ['src/components/**'],
              usage: ['fetch'],
            },
          ],
        },
      });
      return { appDir, outDir };
    };

    it('counts only the production files it governs where the repo turns it off, not the tests it skips', async () => {
      const { appDir, outDir } = declaredApp();
      wire(appDir, `, { files: ['src/components/ui/**'], rules: { '${NO_FETCH}': 'off' } }`);
      await runEslintCheck(appDir, outDir);
      expect(logged()).toContain(
        `${NO_FETCH}: not active for 1 file(s), e.g. src/components/ui/button.tsx`,
      );
      expect(logged()).not.toContain('button.test.tsx');
      expect(process.exitCode).toBe(1);
    });

    it('does not flag a folder the rule never applies to that the repo turns it off for', async () => {
      const { appDir, outDir } = declaredApp();
      wire(appDir, `, { files: ['src/lib/**'], rules: { '${NO_FETCH}': 'off' } }`);
      await runEslintCheck(appDir, outDir);
      expect(logged()).not.toContain('not active');
      expect(logged()).toContain('pass clean');
      expect(process.exitCode).toBe(0);
    });
  });
});
