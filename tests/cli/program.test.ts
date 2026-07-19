import { existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, readVersion } from '../../src/cli/program.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);
const auto = fixture('cli-auto'); // gates AP-002 AUTO
const reject = fixture('ui-infer'); // nothing meets the gate
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
    expect(output()).toContain('No AUTO patterns to generate');
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

  it('errors when the rule id is unknown', async () => {
    await expect(run(['explain', 'AP-999', auto])).rejects.toThrow(/No pattern/);
  });

  it('--version is handled by exitOverride', async () => {
    await expect(run(['--version'])).rejects.toMatchObject({ code: 'commander.version' });
  });
});
