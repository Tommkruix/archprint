import { existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, readVersion } from '../../src/cli/program.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);
const auto = fixture('cli-auto'); // gates AP-002 AUTO
const reject = fixture('ui-infer'); // nothing meets the gate
const layerAuto = fixture('layer-auto'); // gates a helpers !-> views layer boundary AUTO
const multiApp = fixture('multi-app'); // two sibling app dirs under one root
const publicApiAuto = fixture('public-api-auto'); // a barrel with 36 clean consumers gates AUTO
const featureSliceAuto = fixture('feature-slice-auto'); // two isolated slices (40 files) gate AUTO
const testIsolationAuto = fixture('test-isolation-auto'); // 36 clean production files + 3 tests gate AUTO
const appIsolationAuto = fixture('app-isolation-auto'); // two isolated apps (40 files) gate AUTO
const depInternalsAuto = fixture('dependency-internals-auto'); // 36 files import react by root, gate AUTO
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
    await run(['generate', layerAuto, '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.archprint.json'))).toBe(true);
    expect(existsSync(path.join(out, 'eslint-boundaries.archprint.json'))).toBe(true);
    expect(output()).toContain('layer boundaries');
  });

  it('generate writes the public-API deep-import config for an AUTO barrel', async () => {
    await run(['generate', publicApiAuto, '--fast', '--out', out]);
    expect(existsSync(path.join(out, 'dependency-cruiser.public-api.archprint.json'))).toBe(true);
    expect(output()).toContain('public API boundaries');
  });

  it('generate writes the feature-slice config for AUTO slice isolation', async () => {
    await run(['generate', featureSliceAuto, '--fast', '--out', out]);
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
    await run(['generate', appIsolationAuto, '--fast', '--out', out]);
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

  it('scan of a multi-app root reports every app and a summary footer', async () => {
    await run(['scan', multiApp]);
    expect(output()).toContain('### app-a');
    expect(output()).toContain('### app-b');
    expect(output()).toContain('Scanned 2 app directories');
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
