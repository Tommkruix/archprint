import { describe, expect, it } from 'vitest';
import { buildInitManifest } from '../../src/cli/init.js';
import type { Recommendations } from '../../src/cli/recommend.js';

const recommendations: Recommendations = {
  stack: ['next', 'react'],
  evidence: { apps: 100, asOf: '2026-09-01' },
  enforceNow: [{ title: 'Circular dependencies', rate: 56.8 }],
  review: [{ title: 'Entry purity', rate: 2.7 }],
  adopt: [{ title: 'Test isolation', rate: 33.4 }],
};

describe('buildInitManifest', () => {
  it('maps recommendations into a deterministic manifest', () => {
    const manifest = buildInitManifest(recommendations, '1.2.3', {
      app: '.',
      rulesDir: 'archprint-rules',
    });
    expect(manifest).toEqual({
      archprintVersion: '1.2.3',
      app: '.',
      stack: ['next', 'react'],
      rulesDir: 'archprint-rules',
      enforced: [{ title: 'Circular dependencies', rate: 56.8 }],
      review: [{ title: 'Entry purity', rate: 2.7 }],
      adopt: [{ title: 'Test isolation', rate: 33.4 }],
      evidence: { apps: 100, asOf: '2026-09-01' },
    });
  });
});
