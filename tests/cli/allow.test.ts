import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllowError, runAllow } from '../../src/cli/allow.js';
import { buildProgram } from '../../src/cli/program.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('runAllow', () => {
  let cwd: string;
  let repo: string;
  beforeEach(() => {
    cwd = process.cwd();
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-allow-cli-')));
    cpSync(path.join(here, '..', 'fixtures', 'cli-auto'), repo, { recursive: true });
    process.chdir(repo);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  const allow = (overrides: Partial<Parameters<typeof runAllow>[0]> = {}) =>
    runAllow({
      cwd: repo,
      out: '.archprint',
      rule: 'AP-001',
      file: 'app/api/a/route.ts',
      reason: 'x',
      ...overrides,
    });

  it('says to set archprint up first when no rules were adopted here', () => {
    expect(() => allow()).toThrow(AllowError);
    expect(() => allow()).toThrow(/Run archprint init/);
  });

  it('refuses a file outside the app, and removing an exception that was never allowed', async () => {
    await buildProgram('9.9.9').parseAsync(['init', '.'], { from: 'user' });
    expect(() => allow({ file: '../elsewhere.ts' })).toThrow(/is not a file inside the app/);
    expect(() => allow({ remove: true })).toThrow(/There is no allowed exception for AP-001/);
  });
});
