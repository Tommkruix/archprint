import { existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { evaluateGate, REQUEST_ENTRY_ROLES } from '../../src/index.js';
import type { DetectedPattern, GenerationStatus } from '../../src/index.js';
import { scanRepo, type ScannedPattern, type ScanResult } from '../../src/cli/scan.js';
import { renderReport, renderExplain } from '../../src/cli/report.js';
import { writeRules } from '../../src/cli/generate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'ui-infer');

function fakePattern(id: string, status: GenerationStatus): ScannedPattern {
  const violatingFileCount = status === 'AUTO' ? 0 : 4;
  // 50 observations clears the Wilson floor when clean (AUTO); 4 exceptions keeps it a SUGGEST.
  const gate = evaluateGate({ roleFileCount: 50, violatingFileCount, roleConfidence: 0.9 });
  const result: DetectedPattern = {
    id,
    name: `rule-${id}`,
    description: 'd',
    roles: REQUEST_ENTRY_ROLES,
    stats: {
      roleFileCount: 50,
      conformingFileCount: 50 - violatingFileCount,
      violatingFileCount,
      ratio: gate.observedConformance,
      roleConfidence: 0.9,
    },
    gate,
    violations: [],
    infraCaution: false,
    infraExceptions: [],
  };
  return {
    config: {
      id,
      name: `rule-${id}`,
      description: 'd',
      roles: REQUEST_ENTRY_ROLES,
      forbidden: [/x/],
    },
    result,
  };
}

describe('cli scan', () => {
  it('runs the full pipeline on a fixture and renders a report', () => {
    const scan = scanRepo(fixture);
    expect(scan.fileCount).toBeGreaterThan(0);
    expect(scan.patterns.length).toBeGreaterThan(0);
    const report = renderReport(scan, '0.0.0', 5);
    expect(report).toContain('Archprint v0.0.0');
    expect(report).toContain('Scanned');
  });

  it('renders a gate breakdown for a pattern', () => {
    const pattern = scanRepo(fixture).patterns[0]!;
    const explained = renderExplain(pattern);
    expect(explained).toContain(pattern.config.id);
    expect(explained).toContain('Gate:');
  });

  it('truncates the exception list in explain past ten', () => {
    const pattern = fakePattern('AP-002', 'SUGGEST');
    pattern.result.violations = Array.from({ length: 11 }, (_unused, index) => ({
      file: `f${index}.ts`,
      specifier: '@/x',
      leaf: 'x',
    }));
    expect(renderExplain(pattern)).toContain('and 1 more');
  });

  it('separates AUTO into GENERATED and SUGGEST into SUGGESTIONS', () => {
    const scan: ScanResult = {
      appDir: 'x',
      fileCount: 100,
      aliasCount: 2,
      patterns: [fakePattern('AP-002', 'AUTO'), fakePattern('AP-001', 'SUGGEST')],
    };
    const report = renderReport(scan, '1.0.0');
    expect(report).toContain('GENERATED RULES');
    expect(report).toContain('AP-002');
    expect(report).toContain('SUGGESTIONS');
    expect(report).toContain('archprint approve AP-001');
  });

  it('reports nothing-generatable and omits the footer in deep mode', () => {
    const empty: ScanResult = { appDir: 'x', fileCount: 5, aliasCount: 0, patterns: [] };
    const report = renderReport(empty, '1.0.0', 12, true);
    expect(report).toContain('No pattern met the confidence gate');
    expect(report).toContain('(0.0s)');
    expect(report).not.toContain('fast scan at the specifier level');
  });

  it('flags an infrastructure-only exception set with caution', () => {
    const pattern = fakePattern('AP-002', 'SUGGEST');
    pattern.result.infraCaution = true;
    const scan: ScanResult = { appDir: 'x', fileCount: 1, aliasCount: 0, patterns: [pattern] };
    expect(renderReport(scan, '1.0.0')).toContain('caution: exceptions are infrastructure routes');
  });

  it('omits the UI pattern when no UI layer is inferable', () => {
    const scan = scanRepo(path.join(here, '..', 'fixtures', 'walker'));
    expect(scan.patterns.some((pattern) => pattern.config.id === 'AP-002')).toBe(false);
    expect(scan.patterns.some((pattern) => pattern.config.id === 'AP-001')).toBe(true);
  });
});

describe('cli generate', () => {
  const outDir = path.join(here, '__generated__');
  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it('writes the four artifacts for AUTO patterns only', () => {
    rmSync(outDir, { recursive: true, force: true });
    const scan: ScanResult = {
      appDir: 'x',
      fileCount: 10,
      aliasCount: 1,
      patterns: [fakePattern('AP-002', 'AUTO'), fakePattern('AP-001', 'SUGGEST')],
    };
    const written = writeRules(scan, outDir, ['AUTO']);
    expect(written).toHaveLength(1);
    expect(existsSync(path.join(written[0]!, 'rule-AP-002.ts'))).toBe(true);
    expect(existsSync(path.join(written[0]!, 'fixtures', 'failing.ts'))).toBe(true);
  });
});
