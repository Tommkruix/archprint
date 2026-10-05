import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, readVersion } from '../../src/cli/program.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);
const auto = fixture('cli-auto');
const reject = fixture('ui-infer');
const layerAuto = fixture('layer-auto');
const multiApp = fixture('multi-app');
const publicApiAuto = fixture('public-api-auto');
const featureSliceAuto = fixture('feature-slice-auto');
const testIsolationAuto = fixture('test-isolation-auto');
const appIsolationAuto = fixture('app-isolation-auto');
const depInternalsAuto = fixture('dependency-internals-auto');
const roleLayeringAuto = fixture('role-layering-auto');
const entryPurityAuto = fixture('entry-purity-auto');
const phantomDepsAuto = fixture('phantom-deps-auto');
const deepRelativeAuto = fixture('deep-relative-auto');
const consoleAuto = fixture('console-isolation-auto');
const envAuto = fixture('env-access-auto');
const wpkgAuto = fixture('workspace-package-auto');
const storiesAuto = fixture('stories-isolation-auto');
const uiDataAuto = fixture('ui-data-auto');
const serverClientAuto = fixture('server-client-auto');

let logSpy: ReturnType<typeof vi.spyOn>;
const output = (): string => logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
const run = (args: string[]): Promise<unknown> =>
  buildProgram('9.9.9').parseAsync(args, { from: 'user' });

describe('cli program', () => {
  let cwd: string;
  let tmp: string;
  let out: string;
  beforeEach(() => {
    cwd = process.cwd();
    tmp = mkdtempSync(path.join(tmpdir(), 'archprint-prog-'));
    process.chdir(tmp);
    out = path.join(tmp, 'out');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('readVersion returns the package version', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('scan reports generated rules (fast, with footer)', async () => {
    await run(['scan', auto]);
    expect(output()).toContain('Archprint v9.9.9');
    expect(output()).toContain('GENERATED RULES');
    expect(output()).toContain('fast scan at the specifier level');
  });

  it('scan --deep produces the report without the fast-mode footer', async () => {
    await run(['scan', auto, '--deep']);
    expect(output()).toContain('GENERATED RULES');
    expect(output()).not.toContain('fast scan at the specifier level');
  });

  it('scan --json emits a parseable summary with rules and evidence', async () => {
    await run(['scan', auto, '--json']);
    const parsed = JSON.parse(output()) as {
      archprintVersion: string;
      apps: { app: string; fileCount: number; rules: { family: string; status: string }[] }[];
    };
    expect(parsed.archprintVersion).toBe('9.9.9');
    expect(parsed.apps).toHaveLength(1);
    expect(parsed.apps[0]!.rules.some((rule) => rule.family === 'forbidden-imports')).toBe(true);
    expect(parsed.apps[0]!.rules.every((rule) => rule.status !== 'REJECT')).toBe(true);
  });

  it('recommend --json emits per-app tiers as parseable JSON', async () => {
    await run(['recommend', auto, '--json']);
    const parsed = JSON.parse(output()) as {
      archprintVersion: string;
      apps: {
        app: string;
        enforceNow: { title: string }[];
        reportOnly: { title: string }[];
        review: unknown[];
        adopt: unknown[];
      }[];
    };
    expect(parsed.archprintVersion).toBe('9.9.9');
    expect(parsed.apps.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.apps[0]!.enforceNow)).toBe(true);
    expect(Array.isArray(parsed.apps[0]!.adopt)).toBe(true);
    expect(parsed.apps[0]!.reportOnly.map((r) => r.title)).toEqual(['Circular dependencies']);
    expect(parsed.apps[0]!.enforceNow.map((r) => r.title)).not.toContain('Circular dependencies');
  });

  it('recommend discovers every app under a monorepo root', async () => {
    await run(['recommend', multiApp, '--json']);
    const parsed = JSON.parse(output()) as { apps: { app: string }[] };
    expect(parsed.apps.map((a) => a.app).sort()).toEqual(['app-a', 'app-b']);
  });

  it('generate on a monorepo root guides to the discovered app dirs', async () => {
    await expect(run(['generate', multiApp])).rejects.toThrow(/found 2 app directories/);
  });

  it('generate writes the two-file layout and config (deep by default, no warning)', async () => {
    await run(['generate', auto, '--out', out]);
    expect(existsSync(path.join(out, 'eslint.mjs'))).toBe(true);
    expect(existsSync(path.join(out, 'config.json'))).toBe(true);
    expect(output()).not.toContain('Warning');
  });

  it('generate --expand also writes the per-rule artifacts', async () => {
    await run(['generate', auto, '--expand', '--out', out]);
    const dir = path.join(out, 'no-ui-layer-in-server-entry');
    expect(existsSync(path.join(dir, 'no-ui-layer-in-server-entry.ts'))).toBe(true);
    expect(existsSync(path.join(dir, 'no-ui-layer-in-server-entry.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'fixtures', 'passing.ts'))).toBe(true);
    expect(existsSync(path.join(dir, 'fixtures', 'failing.ts'))).toBe(true);
  });

  it('generate --fast warns to confirm with a deep pass before enforcing', async () => {
    await run(['generate', auto, '--fast', '--out', out]);
    expect(output()).toContain('Warning');
    expect(output()).toContain('--fast');
  });

  it('generate reports when there is nothing to generate', async () => {
    await run(['generate', reject, '--out', out]);
    expect(output()).toContain('No AUTO rules to generate');
  });

  it('generate --expand writes the layer-boundary configs for an AUTO boundary', async () => {
    await run(['generate', layerAuto, '--include-structural', '--expand', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.layer.archprint.json'))).toBe(true);
    expect(existsSync(path.join(out, 'eslint-boundaries.archprint.json'))).toBe(true);
    expect(existsSync(path.join(out, 'dependency-cruiser.json'))).toBe(true);
  });

  it('generate holds structural families for review by default (no --include-structural)', async () => {
    await run(['generate', layerAuto, '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.json'))).toBe(false);
    expect(output()).toContain('for review');
  });

  it('generate writes the public-API deep-import rule into the single depcruise file', async () => {
    await run(['generate', publicApiAuto, '--fast', '--out', out]);
    const config = JSON.parse(readFileSync(path.join(out, 'dependency-cruiser.json'), 'utf8')) as {
      forbidden: { name: string }[];
    };
    expect(config.forbidden.some((r) => r.name.startsWith('no-deep-import-'))).toBe(true);
  });

  it('generate --expand writes the feature-slice config for AUTO slice isolation', async () => {
    await run([
      'generate',
      featureSliceAuto,
      '--include-structural',
      '--fast',
      '--expand',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'dependency-cruiser.feature-slice.archprint.json'))).toBe(
      true,
    );
  });

  it('generate --expand writes the depcruise test-isolation config when tests are isolated', async () => {
    await run([
      'generate',
      testIsolationAuto,
      '--fast',
      '--expand',
      '--emit',
      'dependency-cruiser',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'dependency-cruiser.test-isolation.archprint.json'))).toBe(
      true,
    );
  });

  it('generate --emit eslint forces the eslint form of a dual-tool family', async () => {
    await run([
      'generate',
      testIsolationAuto,
      '--emit',
      'eslint',
      '--fast',
      '--expand',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'eslint.no-restricted-imports.archprint.json'))).toBe(true);
    expect(existsSync(path.join(out, 'dependency-cruiser.test-isolation.archprint.json'))).toBe(
      false,
    );
  });

  it('generate --emit dependency-cruiser writes no eslint file', async () => {
    await run(['generate', consoleAuto, '--emit', 'dependency-cruiser', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'eslint.mjs'))).toBe(false);
  });

  it('generate --expand --no-graph skips the layer dependency graph', async () => {
    await run([
      'generate',
      layerAuto,
      '--include-structural',
      '--expand',
      '--no-graph',
      '--fast',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'layer-graph.archprint.mmd'))).toBe(false);
  });

  it('generate rejects an invalid --emit target', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(['generate', layerAuto, '--emit', 'biome', '--out', out]);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('Invalid --emit target');
    process.exitCode = 0;
  });

  it('generate --readme adds a managed archprint section to README.md', async () => {
    await run(['generate', auto, '--readme', '--out', out]);
    const readme = path.join(tmp, 'README.md');
    expect(existsSync(readme)).toBe(true);
    const body = readFileSync(readme, 'utf8');
    expect(body).toContain('<!-- archprint:start -->');
    expect(body).toContain('### Adopted rules');
  });

  it('generate manages a .prettierignore entry for the output dir', async () => {
    await run(['generate', auto]);
    expect(readFileSync(path.join(tmp, '.prettierignore'), 'utf8')).toContain('.archprint/');
  });

  it('never creates a .npmignore when the repo has none (npm pack keeps honoring .gitignore)', async () => {
    await run(['generate', auto]);
    expect(existsSync(path.join(tmp, '.npmignore'))).toBe(false);
  });

  it('appends to an existing .npmignore and removes only the managed block on eject', async () => {
    writeFileSync(path.join(tmp, '.npmignore'), 'dist\n');
    await run(['generate', auto]);
    expect(readFileSync(path.join(tmp, '.npmignore'), 'utf8')).toContain('.archprint/');
    await run(['eject']);
    const after = readFileSync(path.join(tmp, '.npmignore'), 'utf8');
    expect(after).toContain('dist');
    expect(after).not.toContain('archprint');
  });

  it('eject removes a --rule directory it recorded, and the config', async () => {
    await run(['generate', auto, '--rule', 'AP-001']);
    const ruleDir = path.join(tmp, '.archprint', 'no-db-client-in-request-entry');
    expect(existsSync(ruleDir)).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(tmp, '.archprint', 'config.json'), 'utf8')).managed.files,
    ).toContain('.archprint/no-db-client-in-request-entry');
    await run(['eject']);
    expect(existsSync(ruleDir)).toBe(false);
    expect(existsSync(path.join(tmp, '.archprint', 'config.json'))).toBe(false);
  });

  it('generate --rule after init preserves the enforced record in config.json', async () => {
    await run(['init', auto]);
    const before = JSON.parse(readFileSync(path.join(tmp, '.archprint', 'config.json'), 'utf8'));
    expect(before.enforced.length).toBeGreaterThan(0);
    await run(['generate', auto, '--rule', 'AP-001']);
    const after = JSON.parse(readFileSync(path.join(tmp, '.archprint', 'config.json'), 'utf8'));
    expect(after.enforced).toEqual(before.enforced);
    expect(after.managed.files).toContain('.archprint/no-db-client-in-request-entry');
  });

  it('generate --rules --expand emits only the named forbidden-import rule ids', async () => {
    await run(['generate', auto, '--rules', 'AP-002', '--expand', '--out', out]);
    expect(existsSync(path.join(out, 'no-ui-layer-in-server-entry'))).toBe(true);
    expect(existsSync(path.join(out, 'no-db-client-in-request-entry'))).toBe(false);
  });

  it('generate --only --expand emits just that family and skips graph', async () => {
    await run([
      'generate',
      layerAuto,
      '--only',
      'layer',
      '--include-structural',
      '--expand',
      '--fast',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'dependency-cruiser.layer.archprint.json'))).toBe(true);
    expect(existsSync(path.join(out, 'layer-graph.archprint.mmd'))).toBe(false);
  });

  it('generate rejects an invalid --only family', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(['generate', layerAuto, '--only', 'nonsense', '--out', out]);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('Invalid --only family');
    process.exitCode = 0;
  });

  it('generate --check runs the generated eslint rules against the repo', async () => {
    await run(['generate', auto, '--check', '--out', out]);
    expect(output()).toContain('Check: the generated eslint rules pass clean');
  });

  it('generate --expand writes the app-isolation config for AUTO app isolation', async () => {
    await run([
      'generate',
      appIsolationAuto,
      '--include-structural',
      '--fast',
      '--expand',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'dependency-cruiser.app-isolation.archprint.json'))).toBe(
      true,
    );
  });

  it('writes the dependency-internals config only with --include-structural (held for review)', async () => {
    await run(['generate', depInternalsAuto, '--fast', '--expand', '--out', out]);
    expect(
      existsSync(path.join(out, 'dependency-cruiser.dependency-internals.archprint.json')),
    ).toBe(false);
    await run([
      'generate',
      depInternalsAuto,
      '--include-structural',
      '--fast',
      '--expand',
      '--out',
      out,
    ]);
    expect(
      existsSync(path.join(out, 'dependency-cruiser.dependency-internals.archprint.json')),
    ).toBe(true);
  });

  it('generate --expand writes the role-layering config for AUTO role boundaries', async () => {
    await run([
      'generate',
      roleLayeringAuto,
      '--include-structural',
      '--fast',
      '--expand',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'dependency-cruiser.role-layering.archprint.json'))).toBe(
      true,
    );
  });

  it('generate --expand writes the entry-purity config when framework entries are pure', async () => {
    await run([
      'generate',
      entryPurityAuto,
      '--include-structural',
      '--fast',
      '--expand',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'dependency-cruiser.entry-purity.archprint.json'))).toBe(true);
  });

  it('generate --expand writes the phantom-dependency config when imports are all declared', async () => {
    await run([
      'generate',
      phantomDepsAuto,
      '--fast',
      '--include-structural',
      '--expand',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'dependency-cruiser.phantom-deps.archprint.json'))).toBe(true);
  });

  it('generate writes the deep-relative rules into the single eslint file', async () => {
    await run(['generate', deepRelativeAuto, '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'eslint.mjs'))).toBe(true);
  });

  it('generate --expand writes the console-isolation eslint config', async () => {
    await run(['generate', consoleAuto, '--fast', '--expand', '--out', out]);
    expect(existsSync(path.join(out, 'eslint.console.archprint.json'))).toBe(true);
  });

  it('generate --expand writes the env-access eslint config when env reads are centralized', async () => {
    await run(['generate', envAuto, '--include-structural', '--fast', '--expand', '--out', out]);
    expect(existsSync(path.join(out, 'eslint.env-access.archprint.json'))).toBe(true);
  });

  it('generate --expand writes the workspace-package rules into no-restricted-imports', async () => {
    await run(['generate', wpkgAuto, '--include-structural', '--fast', '--expand', '--out', out]);
    expect(existsSync(path.join(out, 'eslint.no-restricted-imports.archprint.json'))).toBe(true);
  });

  it('generate --expand writes the stories-isolation config when stories are unimported', async () => {
    await run([
      'generate',
      storiesAuto,
      '--include-structural',
      '--fast',
      '--expand',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'dependency-cruiser.stories-isolation.archprint.json'))).toBe(
      true,
    );
  });

  it('generate never enforces ui-data: its COMPONENT role is too low-confidence to AUTO', async () => {
    await run(['generate', uiDataAuto, '--include-structural', '--fast', '--expand', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.ui-data.archprint.json'))).toBe(false);
  });

  it('generate --expand writes the server-client config when client code avoids server-only', async () => {
    await run([
      'generate',
      serverClientAuto,
      '--include-structural',
      '--fast',
      '--expand',
      '--out',
      out,
    ]);
    expect(existsSync(path.join(out, 'dependency-cruiser.server-client.archprint.json'))).toBe(
      true,
    );
  });

  it('scan of a multi-app root reports every app and a summary footer', async () => {
    await run(['scan', multiApp]);
    expect(output()).toContain('### app-a');
    expect(output()).toContain('### app-b');
    expect(output()).toContain('Scanned 2 app directories');
  });

  it('recommend prints a rule set for the repo and its stack', async () => {
    await run(['recommend', layerAuto]);
    expect(output()).toContain('recommendations');
    expect(output()).toContain('ENFORCE NOW');
  });

  it('explain shows the gate breakdown', async () => {
    await run(['explain', 'AP-002', auto]);
    expect(output()).toContain('Gate:');
  });

  it('generate --rule emits a specific rule after review', async () => {
    await run(['generate', auto, '--rule', 'AP-001', '--out', out]);
    expect(existsSync(path.join(out, 'no-db-client-in-request-entry'))).toBe(true);
  });

  it('generate --rule --fast warns to confirm with a deep pass', async () => {
    await run(['generate', auto, '--rule', 'AP-001', '--fast', '--out', out]);
    expect(output()).toContain('Warning');
  });

  it('errors when the path has no tsconfig', async () => {
    await expect(run(['scan', here])).rejects.toThrow(/No tsconfig/);
  });

  it('explain errors when the app path has no tsconfig', async () => {
    await expect(run(['explain', 'AP-002', here])).rejects.toThrow(/No tsconfig/);
  });

  it('errors when the rule id is unknown', async () => {
    await expect(run(['explain', 'AP-999', auto])).rejects.toThrow(/No pattern/);
  });

  it('--version is handled by exitOverride', async () => {
    await expect(run(['--version'])).rejects.toMatchObject({ code: 'commander.version' });
  });
});

describe('init', () => {
  let cwd: string;
  let tmp: string;
  beforeEach(() => {
    cwd = process.cwd();
    tmp = mkdtempSync(path.join(tmpdir(), 'archprint-init-'));
    process.chdir(tmp);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
    process.exitCode = 0;
  });

  const config = (): Record<string, unknown> =>
    JSON.parse(readFileSync(path.join(tmp, '.archprint', 'config.json'), 'utf8'));

  it('writes the .archprint layout, a README section, and reports the tiers', async () => {
    await run(['init', auto]);
    expect(existsSync(path.join(tmp, '.archprint', 'config.json'))).toBe(true);
    expect(existsSync(path.join(tmp, '.archprint', 'eslint.mjs'))).toBe(true);
    expect(existsSync(path.join(tmp, '.archprint', 'rules.json'))).toBe(true);
    expect(config().managed).toMatchObject({
      files: expect.arrayContaining(['.archprint/rules.json']),
    });
    expect(readFileSync(path.join(tmp, 'README.md'), 'utf8')).toContain('<!-- archprint:start -->');
    expect(config().archprintVersion).toBe('9.9.9');
    expect((config().enforced as unknown[]).length).toBeGreaterThan(0);
    expect(output()).toContain('initialized');
    expect(output()).toContain('Enforcing now');
    expect(output()).toContain('Wrote .archprint/config.json.');
    const reportedAt = output().indexOf('Report only');
    expect(reportedAt).toBeGreaterThan(output().indexOf('Enforcing now'));
    expect(output().indexOf('Circular dependencies')).toBeGreaterThan(reportedAt);
    expect((config().reportOnly as { title: string }[]).map((r) => r.title)).toEqual([
      'Circular dependencies',
    ]);
    expect((config().enforced as { title: string }[]).map((r) => r.title)).not.toContain(
      'Circular dependencies',
    );
    expect(output()).toContain("Run 'archprint wire'");
  });

  it('records "." for the app path when run from the app directory', async () => {
    cpSync(auto, tmp, { recursive: true });
    await run(['init', '.']);
    expect(config().app).toBe('.');
    expect(config().rulesDir).toBe('.archprint');
  });

  it('refuses to overwrite an existing config without --force', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(['init', auto]);
    await run(['init', auto]);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('already exists');
    expect(process.exitCode).toBe(1);
  });

  it('overwrites an existing config with --force', async () => {
    await run(['init', auto]);
    await run(['init', auto, '--force']);
    expect(existsSync(path.join(tmp, '.archprint', 'config.json'))).toBe(true);
    expect(process.exitCode).not.toBe(1);
  });

  it('reports when no rule is enforceable but still records recommendations', async () => {
    await run(['init', reject]);
    expect(config()).toHaveProperty('adopt');
    expect(output()).toContain('initialized');
    expect(output()).not.toContain('archprint wire');
  });

  it('includes structural families with --include-structural and notes the caveat', async () => {
    await run(['init', layerAuto, '--include-structural']);
    expect(existsSync(path.join(tmp, '.archprint', 'dependency-cruiser.json'))).toBe(true);
    expect(output()).toContain('review before you trust them');
  });

  it('warns to confirm with a deep pass when run with --fast', async () => {
    await run(['init', auto, '--fast']);
    expect(output()).toContain('Warning');
  });

  it('regenerating removes stale outputs before writing fresh ones', async () => {
    await run(['init', auto]);
    await run(['generate', auto]);
    expect(output()).toContain('Refreshed: removed');
  });

  it('eject removes the generated files, the config, and the README section', async () => {
    writeFileSync(path.join(tmp, 'README.md'), '# App\n\nHello.\n');
    await run(['init', auto]);
    expect(existsSync(path.join(tmp, '.archprint'))).toBe(true);
    await run(['eject']);
    expect(existsSync(path.join(tmp, '.archprint'))).toBe(false);
    expect(readFileSync(path.join(tmp, 'README.md'), 'utf8')).not.toContain('archprint:start');
    expect(output()).toContain('Ejected');
  });

  it('generate and eject never delete a path that config.json or the outputs manifest point outside .archprint', async () => {
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(path.join(tmp, 'src', 'keep.ts'), 'export const keep = 1;\n');
    const outside = mkdtempSync(path.join(tmpdir(), 'archprint-outside-'));
    writeFileSync(path.join(outside, 'victim.txt'), 'mine\n');
    const tamper = (): void => {
      const current = config() as { managed: { files: string[] } };
      current.managed.files = [...current.managed.files, 'src', outside];
      writeFileSync(path.join(tmp, '.archprint', 'config.json'), JSON.stringify(current));
    };
    try {
      await run(['init', auto]);
      tamper();
      await run(['generate', auto]);
      expect(existsSync(path.join(tmp, 'src', 'keep.ts'))).toBe(true);
      expect(existsSync(path.join(outside, 'victim.txt'))).toBe(true);
      tamper();
      writeFileSync(
        path.join(tmp, '.archprint', '.archprint-outputs.json'),
        JSON.stringify({ archprintVersion: '9.9.9', outputs: ['../src', outside] }),
      );
      await run(['eject']);
      expect(existsSync(path.join(tmp, 'src', 'keep.ts'))).toBe(true);
      expect(existsSync(path.join(outside, 'victim.txt'))).toBe(true);
      expect(existsSync(path.join(tmp, '.archprint', 'config.json'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses to write or delete through an .archprint folder that is a symlink', async () => {
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(path.join(tmp, 'src', 'keep.ts'), 'export const keep = 1;\n');
    symlinkSync(tmp, path.join(tmp, '.archprint'), 'dir');
    writeFileSync(
      path.join(tmp, '.archprint-outputs.json'),
      JSON.stringify({ archprintVersion: '9.9.9', outputs: ['src'] }),
    );
    await expect(run(['generate', auto])).rejects.toThrow(/symbolic link/);
    await expect(run(['eject'])).rejects.toThrow(/symbolic link/);
    expect(existsSync(path.join(tmp, 'src', 'keep.ts'))).toBe(true);
  });

  it('never edits a README or ignore file that links outside the repository', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'archprint-outside-'));
    try {
      for (const name of ['README.md', '.prettierignore']) {
        writeFileSync(path.join(outside, name), 'mine\n');
        symlinkSync(path.join(outside, name), path.join(tmp, name));
      }
      const untouched = (): void => {
        for (const name of ['README.md', '.prettierignore']) {
          expect(readFileSync(path.join(outside, name), 'utf8')).toBe('mine\n');
        }
      };
      await run(['init', auto]);
      untouched();
      await run(['eject']);
      untouched();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not overwrite an outside file that .archprint/config.json links to', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'archprint-outside-'));
    try {
      writeFileSync(path.join(outside, 'victim.json'), 'mine\n');
      mkdirSync(path.join(tmp, '.archprint'));
      symlinkSync(path.join(outside, 'victim.json'), path.join(tmp, '.archprint', 'config.json'));
      await run(['init', auto]);
      expect(readFileSync(path.join(outside, 'victim.json'), 'utf8')).toBe('mine\n');
      expect(config()).toHaveProperty('managed');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('still updates a README that links to another file inside the repository', async () => {
    mkdirSync(path.join(tmp, 'docs'));
    writeFileSync(path.join(tmp, 'docs', 'README.md'), '# App\n');
    symlinkSync(path.join('docs', 'README.md'), path.join(tmp, 'README.md'));
    await run(['init', auto]);
    expect(readFileSync(path.join(tmp, 'docs', 'README.md'), 'utf8')).toContain('archprint:start');
  });

  it('refuses an --out inside the repository that a committed symlink redirects elsewhere', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'archprint-outside-'));
    try {
      symlinkSync(outside, path.join(tmp, 'rules'), 'dir');
      await expect(run(['init', auto, '--out', 'rules/.archprint'])).rejects.toThrow(
        /symbolic link/,
      );
      expect(existsSync(path.join(outside, '.archprint'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses eject --out pointing at the repository itself', async () => {
    writeFileSync(path.join(tmp, 'config.json'), '{}\n');
    await expect(run(['eject', '--out', '.'])).rejects.toThrow(/--out must be a folder inside/);
    expect(existsSync(path.join(tmp, 'config.json'))).toBe(true);
  });

  it('eject --dry-run lists targets without deleting', async () => {
    await run(['init', auto]);
    await run(['eject', '--dry-run']);
    expect(output()).toContain('Would remove');
    expect(existsSync(path.join(tmp, '.archprint', 'config.json'))).toBe(true);
  });

  it('eject reports when there is nothing to remove', async () => {
    await run(['eject']);
    expect(output()).toContain('Nothing to eject');
  });

  it('wire inserts a managed block into a flat eslint config, and eject removes it', async () => {
    const configFile = path.join(tmp, 'eslint.config.mjs');
    const original = 'export default [\n  { rules: {} },\n];\n';
    writeFileSync(configFile, original);
    await run(['init', auto]);
    await run(['wire']);
    expect(readFileSync(configFile, 'utf8')).toContain('archprint:start');
    expect(readFileSync(configFile, 'utf8')).toContain('...archprintRules');
    await run(['eject']);
    expect(readFileSync(configFile, 'utf8')).toBe(original);
  });

  it('wire is idempotent on a second run', async () => {
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), 'export default [];\n');
    await run(['init', auto]);
    await run(['wire']);
    await run(['wire']);
    expect(output()).toContain('already wired');
  });

  it('wire prints a snippet when there is no eslint config to edit', async () => {
    await run(['init', auto]);
    await run(['wire']);
    expect(output()).toContain('Add this manually');
  });

  it('wire --dry-run does not modify the config', async () => {
    const configFile = path.join(tmp, 'eslint.config.mjs');
    const original = 'export default [];\n';
    writeFileSync(configFile, original);
    await run(['init', auto]);
    await run(['wire', '--dry-run']);
    expect(readFileSync(configFile, 'utf8')).toBe(original);
    expect(output()).toContain('would wire');
  });

  it('wire prints a manual snippet when the config has no array-form export', async () => {
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), 'export default someConfig;\n');
    await run(['init', auto]);
    await run(['wire']);
    expect(output()).toContain('Add this manually');
  });

  it('wire errors when no rules have been generated', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(['wire']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('Run');
    expect(process.exitCode).toBe(1);
  });

  it('wire adds a managed extends to a dependency-cruiser json config, and eject removes it', async () => {
    const configFile = path.join(tmp, '.dependency-cruiser.json');
    const original = '{\n  "forbidden": [],\n  "options": {}\n}\n';
    writeFileSync(configFile, original);
    await run(['init', phantomDepsAuto, '--fast', '--include-structural']);
    await run(['wire']);
    const wired = JSON.parse(readFileSync(configFile, 'utf8')) as { extends?: string };
    expect(wired.extends).toContain('dependency-cruiser.json');
    await run(['eject']);
    expect(JSON.parse(readFileSync(configFile, 'utf8'))).toEqual({ forbidden: [], options: {} });
  });
});

describe('migrate command', () => {
  let cwd: string;
  let tmp: string;
  const wired = [
    '// archprint:start (managed by archprint; run `archprint eject` to remove)',
    "import archprintRules from './archprint-rules/eslint.archprint.mjs';",
    '// archprint:end',
    'export default [',
    '  ...archprintRules, // archprint:managed',
    '];',
    '',
  ].join('\n');
  const setupLegacy = (): void => {
    cpSync(auto, tmp, { recursive: true });
    mkdirSync(path.join(tmp, 'archprint-rules'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'archprint-rules', 'eslint.archprint.mjs'),
      'export default [];\n',
    );
    writeFileSync(
      path.join(tmp, 'archprint-rules', '.archprint-outputs.json'),
      JSON.stringify({ archprintVersion: '0.5.0', outputs: ['eslint.archprint.mjs'] }),
    );
    writeFileSync(
      path.join(tmp, 'archprint.json'),
      JSON.stringify({ archprintVersion: '0.5.0', app: '.', rulesDir: 'archprint-rules' }),
    );
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), wired);
  };
  beforeEach(() => {
    cwd = process.cwd();
    tmp = mkdtempSync(path.join(tmpdir(), 'archprint-migcmd-'));
    process.chdir(tmp);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('migrates a 0.5.0 tree to the .archprint layout', async () => {
    setupLegacy();
    await run(['migrate']);
    expect(output()).toContain('Migrated to the .archprint layout');
    expect(existsSync(path.join(tmp, '.archprint', 'eslint.mjs'))).toBe(true);
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(false);
    expect(readFileSync(path.join(tmp, 'eslint.config.mjs'), 'utf8')).toContain(
      './.archprint/eslint.mjs',
    );
  });

  it('eject cleans a 0.5.0 tree: unwires and removes archprint-rules and archprint.json', async () => {
    setupLegacy();
    await run(['eject']);
    expect(readFileSync(path.join(tmp, 'eslint.config.mjs'), 'utf8')).not.toContain(
      'archprint:start',
    );
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(false);
    expect(existsSync(path.join(tmp, 'archprint.json'))).toBe(false);
  });

  it('generate refuses on a stale 0.5.0 tree and points to migrate', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupLegacy();
    await run(['generate', '.']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('migrate');
    expect(process.exitCode).toBe(1);
  });

  it('init refuses on a stale 0.5.0 tree and points to migrate', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupLegacy();
    await run(['init', '.']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('migrate');
    expect(process.exitCode).toBe(1);
  });

  it('upgrade is an alias for migrate', async () => {
    setupLegacy();
    await run(['upgrade']);
    expect(existsSync(path.join(tmp, '.archprint', 'eslint.mjs'))).toBe(true);
  });

  it('--dry-run changes nothing', async () => {
    setupLegacy();
    await run(['migrate', '--dry-run']);
    expect(output()).toContain('Would migrate');
    expect(existsSync(path.join(tmp, '.archprint'))).toBe(false);
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(true);
  });

  it('reports nothing to migrate when there is no legacy layout', async () => {
    cpSync(auto, tmp, { recursive: true });
    await run(['migrate']);
    expect(output()).toContain('Nothing to migrate');
  });

  it('aborts with exit 1 on an unmarked plugin import', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    cpSync(auto, tmp, { recursive: true });
    mkdirSync(path.join(tmp, 'archprint-rules'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'archprint.json'),
      JSON.stringify({ archprintVersion: '0.5.0', app: '.' }),
    );
    writeFileSync(
      path.join(tmp, 'eslint.config.mjs'),
      "import plugin from './archprint-rules/eslint-plugin.archprint.mjs';\nexport default plugin;\n",
    );
    await run(['migrate']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('Migration stopped');
    expect(process.exitCode).toBe(1);
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(true);
  });
});
