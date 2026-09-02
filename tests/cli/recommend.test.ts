import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { buildRecommendations, detectStack } from '../../src/cli/recommend.js';
import { renderRecommendations } from '../../src/cli/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);

describe('detectStack', () => {
  it('detects a framework from package.json dependencies', () => {
    expect(detectStack(fixture('phantom-deps')).has('react')).toBe(true);
  });

  it('detects a monorepo from workspaces', () => {
    expect(detectStack(fixture('workspace-package')).has('monorepo')).toBe(true);
  });
});

describe('buildRecommendations', () => {
  it('enforce-now holds only audit-stable AUTO families; structural AUTO is capped at review', () => {
    const stable = buildRecommendations(scanRepo(fixture('cli-auto'), { deep: false }), new Set());
    expect(stable.enforceNow.some((r) => r.title.startsWith('Forbidden imports'))).toBe(true);
    expect(stable.evidence.apps).toBeGreaterThan(0);

    const structural = buildRecommendations(
      scanRepo(fixture('layer-auto'), { deep: false }),
      detectStack(fixture('layer-auto')),
    );
    expect(structural.enforceNow.some((r) => r.title === 'Layer boundaries')).toBe(false);
    const layer = structural.review.find((r) => r.title === 'Layer boundaries');
    expect(layer).toBeDefined();
    expect(typeof layer?.rate).toBe('number');
  });

  it('adopts families common in comparable repos, drops rare ones, sorted by rate', () => {
    const scan = scanRepo(fixture('layers'), { deep: false });
    const rec = buildRecommendations(scan, new Set(['react']));
    const adopt = rec.adopt.map((r) => r.title);
    expect(adopt).toContain('UI / data separation');
    expect(adopt).not.toContain('Stories isolation');
    const rates = rec.adopt.map((r) => r.rate ?? -1);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
    expect(rec.stack).toEqual(['react']);
  });

  it('carries a null rate for a family whose census number was invalidated (env access)', () => {
    const scan = scanRepo(fixture('layers'), { deep: false });
    const rec = buildRecommendations(scan, new Set(['react']));
    const env = [...rec.enforceNow, ...rec.review, ...rec.adopt].find(
      (r) => r.title === 'Env access',
    );
    expect(env).toBeDefined();
    expect(env?.rate).toBeNull();
  });

  it('renders the tiers, the detected stack, the evidence line, and a percentage', () => {
    const scan = scanRepo(fixture('layer-auto'), { deep: false });
    const out = renderRecommendations(buildRecommendations(scan, new Set(['next'])), '1.0.0');
    expect(out).toContain('recommendations');
    expect(out).toContain('Detected stack: next');
    expect(out).toContain('ENFORCE NOW');
    expect(out).toContain('Evidence:');
    expect(out).toMatch(/\d+% of comparable repos/);
  });
});
