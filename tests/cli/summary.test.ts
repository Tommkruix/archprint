import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/cli/scan.js';
import { summarizeRules, toScanSummary } from '../../src/cli/summary.js';
import { FAMILY_STATEMENTS } from '../../src/cli/rule-statements.js';

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
      expect(rule.statement.length).toBeGreaterThan(0);
      expect(Array.isArray(rule.exceptions)).toBe(true);
    }
  });

  it('states each rule in the words the scan report uses', () => {
    const consoleRule = summary.rules.find((rule) => rule.family === 'console-isolation');
    expect(consoleRule?.statement).toBe(FAMILY_STATEMENTS['console-isolation']);
    const pattern = scanRepo(fixture).patterns.find((p) => p.config.id === 'AP-002');
    expect(summary.rules.find((rule) => rule.label === 'AP-002')?.statement).toBe(
      pattern?.config.description,
    );
  });

  it('lists the files that break a rule, capped by the exception limit', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'archprint-summary-'));
    try {
      cpSync(fixture, tmp, { recursive: true });
      writeFileSync(path.join(tmp, 'lib', 'flag.ts'), 'export const flag = process.env.FLAG;\n');
      const scan = scanRepo(tmp);
      const envRule = (limit?: number) =>
        summarizeRules(scan, limit).find((rule) => rule.family === 'env-access');
      expect(envRule()?.exceptions).toEqual(['lib/flag.ts']);
      expect(envRule()?.violatingFiles).toBe(1);
      expect(envRule(0)?.exceptions).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('names every file in an import cycle as an exception to the cycles rule', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'archprint-summary-'));
    try {
      cpSync(fixture, tmp, { recursive: true });
      writeFileSync(
        path.join(tmp, 'lib', 'a.ts'),
        "import { b } from './b';\nexport const a = () => b;\n",
      );
      writeFileSync(
        path.join(tmp, 'lib', 'b.ts'),
        "import { a } from './a';\nexport const b = () => a;\n",
      );
      const cycles = summarizeRules(scanRepo(tmp)).find((rule) => rule.family === 'cycles');
      expect(cycles?.exceptions).toEqual(['lib/a.ts', 'lib/b.ts']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
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
