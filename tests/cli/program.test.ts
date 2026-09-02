import { existsSync, rmSync } from 'node:fs';
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

  it('generate writes the ui-data config when components avoid the data layer', async () => {
    await run(['generate', uiDataAuto, '--include-structural', '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.ui-data.archprint.json'))).toBe(true);
    expect(output()).toContain('UI / data separation');
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
