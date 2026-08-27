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
  it('puts a repo’s AUTO families in the enforce-now tier', () => {
    const scan = scanRepo(fixture('layer-auto'), { deep: false });
    const rec = buildRecommendations(scan, detectStack(fixture('layer-auto')));
    expect(rec.enforceNow.length).toBeGreaterThan(0);
    expect(rec.enforceNow).toContain('Layer boundaries');
  });

  it('recommends universal and stack families to adopt when the code does not evidence them yet', () => {
    // The layers fixture has no components, so UI/data is unevidenced; with a react stack it becomes a
    // day-one recommendation. This is the fresh-repo path: guidance from the stack, not inference.
    const scan = scanRepo(fixture('layers'), { deep: false });
    const rec = buildRecommendations(scan, new Set(['react']));
    expect(rec.adopt).toContain('UI / data separation');
    expect(rec.stack).toEqual(['react']);
  });

  it('renders the three tiers with the detected stack', () => {
    const scan = scanRepo(fixture('layer-auto'), { deep: false });
    const out = renderRecommendations(buildRecommendations(scan, new Set(['next'])), '1.0.0');
    expect(out).toContain('recommendations');
    expect(out).toContain('Detected stack: next');
    expect(out).toContain('ENFORCE NOW');
  });
});
