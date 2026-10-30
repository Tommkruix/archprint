import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readConfig } from '../../src/cli/archprint-config.js';
import { readAdoptedRules } from '../../src/cli/adopted-rules.js';
import { writeLayout, type WriteLayoutOptions } from '../../src/cli/layout.js';
import { buildRecommendations } from '../../src/cli/recommend.js';
import { scanRepo } from '../../src/cli/scan.js';
import type { InstalledEnforcers } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ESLINT: InstalledEnforcers = {
  eslint: true,
  eslintPluginImport: false,
  dependencyCruiser: false,
  biome: false,
};
const ENV_MESSAGE = 'Read environment variables only in the config/env layer.';

const fixture = (name: string) => scanRepo(path.join(here, '..', 'fixtures', name));

describe('writeLayout', () => {
  const scan = fixture('env-access-auto');
  let cwd: string;
  let outDir: string;
  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'archprint-layout-'));
    outDir = path.join(cwd, '.archprint');
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  const write = (options: Partial<WriteLayoutOptions> = {}, scanned = scan) =>
    writeLayout(scanned, outDir, {
      enforcers: ESLINT,
      mode: 'fast',
      version: '9.9.9',
      recommendations: buildRecommendations(scanned, new Set(), ESLINT),
      app: '.',
      cwd,
      ...options,
    });
  const adoptedIds = (): string[] => (readAdoptedRules(outDir) ?? []).map((rule) => rule.id);
  const eslintSource = (): string => readFileSync(path.join(outDir, 'eslint.mjs'), 'utf8');
  const readmeSection = (heading: string): string => {
    const readme = readFileSync(path.join(cwd, 'README.md'), 'utf8');
    return readme.split(`### ${heading}`)[1]?.split('###')[0] ?? '';
  };

  it('records, enforces, and documents a held rule adopted with --rules the same way', () => {
    write({ structural: true, ruleIds: ['env-access', 'console-isolation'], readme: true });

    expect(adoptedIds()).toEqual(['console-isolation', 'env-access']);
    expect(eslintSource()).toContain(ENV_MESSAGE);
    const config = readConfig(outDir)!;
    expect(config.enforced.map((entry) => entry.title).sort()).toEqual([
      'Console isolation',
      'Env access',
    ]);
    expect(config.review.map((entry) => entry.title)).not.toContain('Env access');
    expect(readmeSection('Adopted rules')).toContain('Env access');
    expect(readmeSection('Held for review')).not.toContain('Env access');
    expect(readmeSection('Report only')).toContain('Circular dependencies');
  });

  it('refreshes to the default rule set when run without a scope', () => {
    write({ structural: true, ruleIds: ['env-access'] });
    write();
    expect(adoptedIds()).toEqual(['console-isolation', 'no-cycles']);
    expect(existsSync(path.join(outDir, 'eslint.mjs'))).toBe(true);
    expect(eslintSource()).not.toContain(ENV_MESSAGE);
  });
});
