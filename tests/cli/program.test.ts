import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const out = path.join(here, '__prog__');

let logSpy: ReturnType<typeof vi.spyOn>;
const output = (): string => logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
const run = (args: string[]): Promise<unknown> =>
  buildProgram('9.9.9').parseAsync(args, { from: 'user' });

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(out, { recursive: true, force: true });
});

describe('cli program', () => {
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

  it('generate writes all four artifacts (deep by default, no warning)', async () => {
    await run(['generate', auto, '--out', out]);
    const dir = path.join(out, 'no-ui-layer-in-server-entry');
    expect(existsSync(path.join(dir, 'no-ui-layer-in-server-entry.ts'))).toBe(true);
    expect(existsSync(path.join(dir, 'no-ui-layer-in-server-entry.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'fixtures', 'passing.ts'))).toBe(true);
    expect(existsSync(path.join(dir, 'fixtures', 'failing.ts'))).toBe(true);
    expect(output()).not.toContain('Warning');
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

  it('generate writes the layer-boundary configs for an AUTO boundary', async () => {
    await run(['generate', layerAuto, '--include-structural', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.archprint.json'))).toBe(true);
    expect(existsSync(path.join(out, 'eslint-boundaries.archprint.json'))).toBe(true);
    expect(output()).toContain('layer boundaries');
  });

  it('generate holds structural families for review by default (no --include-structural)', async () => {
    await run(['generate', layerAuto, '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.archprint.json'))).toBe(false);
    expect(output()).toContain('structural rule(s) for review');
  });

  it('generate writes the public-API deep-import config for an AUTO barrel', async () => {
    await run(['generate', publicApiAuto, '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.public-api.archprint.json'))).toBe(true);
    expect(output()).toContain('public API boundaries');
  });

  it('generate writes the feature-slice config for AUTO slice isolation', async () => {
    await run(['generate', featureSliceAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.feature-slice.archprint.json'))).toBe(
      true,
    );
    expect(output()).toContain('feature-slice boundaries');
  });

  it('generate writes the test-isolation config when tests are cleanly isolated', async () => {
    await run(['generate', testIsolationAuto, '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.test-isolation.archprint.json'))).toBe(
      true,
    );
    expect(output()).toContain('test isolation');
  });

  it('generate writes the app-isolation config for AUTO app isolation', async () => {
    await run(['generate', appIsolationAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.app-isolation.archprint.json'))).toBe(
      true,
    );
    expect(output()).toContain('app boundaries');
  });

  it('generate writes the dependency-internals config when packages are imported cleanly', async () => {
    await run(['generate', depInternalsAuto, '--fast', '--out', out]);
    expect(
      existsSync(path.join(out, 'dependency-cruiser.dependency-internals.archprint.json')),
    ).toBe(true);
    expect(output()).toContain('dependency hygiene');
  });

  it('generate writes the role-layering config for AUTO role boundaries', async () => {
    await run(['generate', roleLayeringAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.role-layering.archprint.json'))).toBe(
      true,
    );
    expect(output()).toContain('role-layering boundaries');
  });

  it('generate writes the entry-purity config when framework entries are pure', async () => {
    await run(['generate', entryPurityAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.entry-purity.archprint.json'))).toBe(true);
    expect(output()).toContain('entry purity');
  });

  it('generate writes the phantom-dependency config when imports are all declared', async () => {
    await run(['generate', phantomDepsAuto, '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.phantom-deps.archprint.json'))).toBe(true);
    expect(output()).toContain('dependency declaration');
  });

  it('generate writes the deep-relative eslint config when relatives are shallow', async () => {
    await run(['generate', deepRelativeAuto, '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'eslint.deep-relative.archprint.json'))).toBe(true);
    expect(output()).toContain('import style');
  });

  it('generate writes the console-isolation eslint config when library avoids console', async () => {
    await run(['generate', consoleAuto, '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'eslint.console-isolation.archprint.json'))).toBe(true);
    expect(output()).toContain('console isolation');
  });

  it('generate writes the env-access eslint config when env reads are centralized', async () => {
    await run(['generate', envAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'eslint.env-access.archprint.json'))).toBe(true);
    expect(output()).toContain('env access');
  });

  it('generate writes the workspace-package eslint config when packages import by name', async () => {
    await run(['generate', wpkgAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'eslint.workspace-package.archprint.json'))).toBe(true);
    expect(output()).toContain('workspace package API');
  });

  it('generate writes the stories-isolation config when stories are unimported', async () => {
    await run(['generate', storiesAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.stories-isolation.archprint.json'))).toBe(
      true,
    );
    expect(output()).toContain('stories isolation');
  });

  it('generate never enforces ui-data: its COMPONENT role is too low-confidence to AUTO', async () => {
    await run(['generate', uiDataAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.ui-data.archprint.json'))).toBe(false);
  });

  it('generate writes the server-client config when client code avoids server-only', async () => {
    await run(['generate', serverClientAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.server-client.archprint.json'))).toBe(
      true,
    );
    expect(output()).toContain('server / client boundary');
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

  it('approve generates a specific rule after review', async () => {
    await run(['approve', 'AP-001', auto, '--out', out]);
    expect(existsSync(path.join(out, 'no-db-client-in-request-entry'))).toBe(true);
  });

  it('approve --fast warns to confirm with a deep pass', async () => {
    await run(['approve', 'AP-001', auto, '--fast', '--out', out]);
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
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('writes a manifest and enforcement configs and reports the tiers', async () => {
    await run(['init', auto]);
    expect(existsSync(path.join(tmp, 'archprint.json'))).toBe(true);
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(true);
    const manifest = JSON.parse(readFileSync(path.join(tmp, 'archprint.json'), 'utf8'));
    expect(manifest.archprintVersion).toBe('9.9.9');
    expect(manifest.enforced.length).toBeGreaterThan(0);
    expect(output()).toContain('initialized');
    expect(output()).toContain('Enforcing now');
  });

  it('records "." for the app path when run from the app directory', async () => {
    cpSync(auto, tmp, { recursive: true });
    await run(['init', '.']);
    const manifest = JSON.parse(readFileSync(path.join(tmp, 'archprint.json'), 'utf8'));
    expect(manifest.app).toBe('.');
    expect(manifest.rulesDir).toBe('archprint-rules');
  });

  it('refuses to overwrite an existing manifest without --force', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(['init', auto]);
    await run(['init', auto]);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('already exists');
    expect(process.exitCode).toBe(1);
  });

  it('overwrites an existing manifest with --force', async () => {
    await run(['init', auto]);
    await run(['init', auto, '--force']);
    expect(existsSync(path.join(tmp, 'archprint.json'))).toBe(true);
    expect(process.exitCode).not.toBe(1);
  });

  it('reports when no rule is enforceable but still records recommendations', async () => {
    await run(['init', reject]);
    const manifest = JSON.parse(readFileSync(path.join(tmp, 'archprint.json'), 'utf8'));
    expect(manifest).toHaveProperty('adopt');
    expect(output()).toContain('initialized');
  });

  it('includes structural families with --include-structural and notes the caveat', async () => {
    await run(['init', layerAuto, '--include-structural']);
    expect(existsSync(path.join(tmp, 'archprint-rules', 'dependency-cruiser.archprint.json'))).toBe(
      true,
    );
    expect(output()).toContain('review before you trust them');
  });

  it('warns to confirm with a deep pass when run with --fast', async () => {
    await run(['init', auto, '--fast']);
    expect(output()).toContain('Warning');
  });

  it('regenerating removes stale outputs before writing fresh ones', async () => {
    await run(['init', auto]);
    await run(['generate', auto, '--out', 'archprint-rules']);
    expect(output()).toContain('Refreshed: removed');
  });

  it('eject removes the generated files and the manifests', async () => {
    await run(['init', auto]);
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(true);
    await run(['eject', '--out', 'archprint-rules']);
    expect(existsSync(path.join(tmp, 'archprint.json'))).toBe(false);
    expect(existsSync(path.join(tmp, 'archprint-rules'))).toBe(false);
    expect(output()).toContain('Ejected');
  });

  it('eject --dry-run lists targets without deleting', async () => {
    await run(['init', auto]);
    await run(['eject', '--out', 'archprint-rules', '--dry-run']);
    expect(output()).toContain('Would remove');
    expect(existsSync(path.join(tmp, 'archprint.json'))).toBe(true);
  });

  it('eject reports when there is nothing to remove', async () => {
    await run(['eject', '--out', 'archprint-rules']);
    expect(output()).toContain('Nothing to eject');
  });

  it('wire inserts a managed block into a flat eslint config, and eject removes it', async () => {
    const config = path.join(tmp, 'eslint.config.mjs');
    const original = 'export default [\n  { rules: {} },\n];\n';
    writeFileSync(config, original);
    await run(['init', auto]);
    await run(['wire', '--out', 'archprint-rules']);
    expect(readFileSync(config, 'utf8')).toContain('archprint:start');
    expect(readFileSync(config, 'utf8')).toContain('...archprintRules');
    await run(['eject', '--out', 'archprint-rules']);
    expect(readFileSync(config, 'utf8')).toBe(original);
  });

  it('wire is idempotent on a second run', async () => {
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), 'export default [];\n');
    await run(['init', auto]);
    await run(['wire', '--out', 'archprint-rules']);
    await run(['wire', '--out', 'archprint-rules']);
    expect(output()).toContain('already wired');
  });

  it('wire prints a snippet when there is no eslint config to edit', async () => {
    await run(['init', auto]);
    await run(['wire', '--out', 'archprint-rules']);
    expect(output()).toContain('Add this to your config');
  });

  it('wire --dry-run does not modify the config', async () => {
    const config = path.join(tmp, 'eslint.config.mjs');
    const original = 'export default [];\n';
    writeFileSync(config, original);
    await run(['init', auto]);
    await run(['wire', '--out', 'archprint-rules', '--dry-run']);
    expect(readFileSync(config, 'utf8')).toBe(original);
    expect(output()).toContain('Would wire');
  });

  it('wire prints a manual snippet when the config has no array-form export', async () => {
    writeFileSync(path.join(tmp, 'eslint.config.mjs'), 'export default someConfig;\n');
    await run(['init', auto]);
    await run(['wire', '--out', 'archprint-rules']);
    expect(output()).toContain('Add this manually');
  });

  it('wire errors when no eslint rule blocks have been generated', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(['wire', '--out', 'archprint-rules']);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('Run');
    expect(process.exitCode).toBe(1);
  });
});
