import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { writeEnforcementConfigs } from '../../src/cli/generate.js';
import type { InstalledEnforcers } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);
const enforcers = (overrides: Partial<InstalledEnforcers>): InstalledEnforcers => ({
  eslint: false,
  eslintPluginImport: false,
  dependencyCruiser: false,
  biome: false,
  ...overrides,
});

describe('writeEnforcementConfigs enforcer gating', () => {
  let out: string;
  beforeEach(() => {
    out = mkdtempSync(path.join(tmpdir(), 'archprint-enforcers-'));
  });
  afterEach(() => {
    rmSync(out, { recursive: true, force: true });
  });
  const has = (name: string): boolean => existsSync(path.join(out, name));

  it('emits the eslint test-isolation rule (not depcruise) for an eslint-only repo', () => {
    writeEnforcementConfigs(scanRepo(fixture('test-isolation-auto')), out, {
      enforcers: enforcers({ eslint: true }),
    });
    expect(has('eslint.no-restricted-imports.archprint.json')).toBe(true);
    expect(has('dependency-cruiser.test-isolation.archprint.json')).toBe(false);
  });

  it('emits the depcruise test-isolation rule (not eslint) for a dependency-cruiser-only repo', () => {
    writeEnforcementConfigs(scanRepo(fixture('test-isolation-auto')), out, {
      enforcers: enforcers({ dependencyCruiser: true }),
    });
    expect(has('dependency-cruiser.test-isolation.archprint.json')).toBe(true);
    expect(has('eslint.no-restricted-imports.archprint.json')).toBe(false);
  });

  it('emits phantom-deps only for dependency-cruiser, not ESLint', () => {
    writeEnforcementConfigs(scanRepo(fixture('phantom-deps-auto')), out, {
      enforcers: enforcers({ dependencyCruiser: true }),
      structural: true,
    });
    expect(has('dependency-cruiser.phantom-deps.archprint.json')).toBe(true);
    expect(has('eslint.phantom-deps.archprint.json')).toBe(false);
  });

  it('does not emit phantom-deps at all on an eslint-only repo (no safe ESLint form)', () => {
    writeEnforcementConfigs(scanRepo(fixture('phantom-deps-auto')), out, {
      enforcers: enforcers({ eslint: true, eslintPluginImport: true }),
    });
    expect(has('eslint.phantom-deps.archprint.json')).toBe(false);
    expect(has('dependency-cruiser.phantom-deps.archprint.json')).toBe(false);
  });

  it('writes no dependency-cruiser file to disk for an eslint-only repo (no orphaned outputs)', () => {
    writeEnforcementConfigs(scanRepo(fixture('dependency-internals-auto')), out, {
      structural: true,
      enforcers: enforcers({ eslint: true }),
    });
    expect(has('dependency-cruiser.dependency-internals.archprint.json')).toBe(false);
    expect(has('dependency-cruiser.public-api.archprint.json')).toBe(false);
  });
});
