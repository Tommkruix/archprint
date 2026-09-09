import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { buildRecommendations, detectStack, resolveEnforcer } from '../../src/cli/recommend.js';
import { renderRecommendations } from '../../src/cli/report.js';
import type { InstalledEnforcers } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);
const allTools: InstalledEnforcers = {
  eslint: true,
  eslintPluginImport: true,
  dependencyCruiser: true,
  biome: false,
};

describe('detectStack', () => {
  it('detects a framework from package.json dependencies', () => {
    expect(detectStack(fixture('phantom-deps')).has('react')).toBe(true);
  });

  it('detects a monorepo from workspaces', () => {
    expect(detectStack(fixture('workspace-package')).has('monorepo')).toBe(true);
  });

  it('detects angular from @angular/* dependencies', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'archprint-ng-'));
    try {
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: { '@angular/core': '^17.0.0' } }),
      );
      expect(detectStack(dir).has('angular')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveEnforcer', () => {
  const only = (o: Partial<InstalledEnforcers>): InstalledEnforcers => ({
    eslint: false,
    eslintPluginImport: false,
    dependencyCruiser: false,
    biome: false,
    ...o,
  });
  it('names the installed tool, or what is missing, per family', () => {
    expect(resolveEnforcer('console-isolation', only({ eslint: true }))).toBe('eslint');
    expect(resolveEnforcer('console-isolation', only({ dependencyCruiser: true }))).toBe(
      'needs eslint',
    );
    expect(resolveEnforcer('layer', only({ dependencyCruiser: true }))).toBe('dependency-cruiser');
    expect(resolveEnforcer('layer', only({ eslint: true }))).toBe('needs dependency-cruiser');
    expect(resolveEnforcer('test-isolation', only({ eslint: true }))).toBe('eslint');
    expect(resolveEnforcer('test-isolation', only({ dependencyCruiser: true }))).toBe(
      'dependency-cruiser',
    );
    expect(resolveEnforcer('phantom-deps', only({ eslint: true, eslintPluginImport: true }))).toBe(
      'eslint-plugin-import',
    );
    expect(resolveEnforcer('phantom-deps', only({ dependencyCruiser: true }))).toBe(
      'dependency-cruiser',
    );
    expect(resolveEnforcer('phantom-deps', only({ eslint: true }))).toBe(
      'needs eslint-plugin-import or dependency-cruiser',
    );
    expect(resolveEnforcer('cycles', only({ eslint: true }))).toBe('');
  });
});

describe('buildRecommendations', () => {
  it('enforce-now holds only audit-stable AUTO families; structural AUTO is capped at review', () => {
    const stable = buildRecommendations(
      scanRepo(fixture('cli-auto'), { deep: false }),
      new Set(),
      allTools,
    );
    const forbidden = stable.enforceNow.find((r) => r.title.startsWith('Forbidden imports'));
    expect(forbidden).toBeDefined();
    expect(forbidden?.enforcer).toBe('eslint');
    expect(stable.evidence.apps).toBeGreaterThan(0);

    const structural = buildRecommendations(
      scanRepo(fixture('layer-auto'), { deep: false }),
      detectStack(fixture('layer-auto')),
      allTools,
    );
    expect(structural.enforceNow.some((r) => r.title === 'Layer boundaries')).toBe(false);
    const layer = structural.review.find((r) => r.title === 'Layer boundaries');
    expect(layer).toBeDefined();
    expect(typeof layer?.rate).toBe('number');
  });

  it('adopts families common in comparable repos, drops rare ones, sorted by rate', () => {
    const scan = scanRepo(fixture('layers'), { deep: false });
    const rec = buildRecommendations(scan, new Set(['react']), allTools);
    const adopt = rec.adopt.map((r) => r.title);
    expect(adopt).toContain('UI / data separation');
    expect(adopt).not.toContain('Stories isolation');
    const rates = rec.adopt.map((r) => r.rate ?? -1);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
    expect(rec.stack).toEqual(['react']);
  });

  it('carries a null rate for a family whose census number was invalidated (env access)', () => {
    const scan = scanRepo(fixture('layers'), { deep: false });
    const rec = buildRecommendations(scan, new Set(['react']), allTools);
    const env = [...rec.enforceNow, ...rec.review, ...rec.adopt].find(
      (r) => r.title === 'Env access',
    );
    expect(env).toBeDefined();
    expect(env?.rate).toBeNull();
  });

  it('renders the tiers, the detected stack, the evidence line, and a percentage', () => {
    const scan = scanRepo(fixture('layer-auto'), { deep: false });
    const out = renderRecommendations(
      buildRecommendations(scan, new Set(['next']), allTools),
      '1.0.0',
    );
    expect(out).toContain('recommendations');
    expect(out).toContain('Detected stack: next');
    expect(out).toContain('ENFORCE NOW');
    expect(out).toContain('Evidence:');
    expect(out).toMatch(/\d+% of comparable repos/);
  });
});
