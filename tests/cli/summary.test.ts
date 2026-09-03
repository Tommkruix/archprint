import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { toScanSummary } from '../../src/cli/summary.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'cli-auto');

describe('toScanSummary', () => {
  const summary = toScanSummary(scanRepo(fixture));

  it('reports file and alias counts', () => {
    expect(summary.fileCount).toBeGreaterThan(0);
    expect(summary.aliasCount).toBeGreaterThanOrEqual(0);
  });

  it('lists rules with stable, serializable evidence fields', () => {
    expect(summary.rules.length).toBeGreaterThan(0);
    for (const rule of summary.rules) {
      expect(typeof rule.family).toBe('string');
      expect(typeof rule.label).toBe('string');
      expect(['AUTO', 'SUGGEST']).toContain(rule.status);
      expect(typeof rule.observedConformance).toBe('number');
      expect(typeof rule.confidenceFloor).toBe('number');
      expect(typeof rule.observations).toBe('number');
      expect(typeof rule.violatingFiles).toBe('number');
    }
  });

  it('omits REJECT rules and is JSON-serializable', () => {
    expect(summary.rules.every((rule) => rule.status !== 'REJECT')).toBe(true);
    expect(() => JSON.stringify(summary)).not.toThrow();
  });

  it('summarizes the group-based structural families', () => {
    const families = new Set<string>();
    for (const name of [
      'layer-auto',
      'role-layering-auto',
      'public-api-auto',
      'feature-slice-auto',
      'app-isolation-auto',
    ]) {
      for (const rule of toScanSummary(scanRepo(path.join(here, '..', 'fixtures', name))).rules) {
        families.add(rule.family);
      }
    }
    for (const family of [
      'layer',
      'role-layering',
      'public-api',
      'feature-slice',
      'app-isolation',
    ]) {
      expect(families.has(family)).toBe(true);
    }
  });
});
