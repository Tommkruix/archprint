import { describe, expect, it } from 'vitest';
import { buildConfig, type ManagedOutputs } from '../../src/cli/archprint-config.js';
import type { Recommendations } from '../../src/cli/recommend.js';

const recommendations: Recommendations = {
  stack: ['next', 'react'],
  evidence: { apps: 100, asOf: '2026-09-01' },
  enforceNow: [{ title: 'Console isolation', rate: 22.2, enforcer: 'eslint' }],
  reportOnly: [{ title: 'Circular dependencies', rate: 56.8, enforcer: '' }],
  review: [{ title: 'Entry purity', rate: 2.7, enforcer: 'dependency-cruiser' }],
  adopt: [{ title: 'Test isolation', rate: 33.4, enforcer: 'eslint' }],
};

const managed: ManagedOutputs = {
  files: ['.archprint/eslint.mjs'],
  readme: true,
  readmeCreated: false,
  prettierignore: true,
  prettierignoreCreated: true,
  npmignore: false,
  npmignoreCreated: false,
};

describe('buildConfig', () => {
  it('maps recommendations into a deterministic config', () => {
    const config = buildConfig(
      recommendations,
      '1.2.3',
      { app: '.', rulesDir: '.archprint' },
      { rules: [], allowed: [] },
      managed,
    );
    expect(config).toEqual({
      archprintVersion: '1.2.3',
      app: '.',
      stack: ['next', 'react'],
      rulesDir: '.archprint',
      rules: [],
      allowed: [],
      enforced: [{ title: 'Console isolation', rate: 22.2, enforcer: 'eslint' }],
      reportOnly: [{ title: 'Circular dependencies', rate: 56.8, enforcer: '' }],
      review: [{ title: 'Entry purity', rate: 2.7, enforcer: 'dependency-cruiser' }],
      adopt: [{ title: 'Test isolation', rate: 33.4, enforcer: 'eslint' }],
      evidence: { apps: 100, asOf: '2026-09-01' },
      managed,
    });
  });
});
