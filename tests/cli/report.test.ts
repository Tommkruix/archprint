import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../../src/index.js';
import type { LayerBoundary } from '../../src/detector/layer-detector.js';
import { renderReport } from '../../src/cli/report.js';
import type { ScanResult } from '../../src/cli/scan.js';

const suggestBoundary = (from: string, to: string, violating = 0): LayerBoundary => {
  const roleFileCount = 5;
  const gate = evaluateGate({ roleFileCount, violatingFileCount: violating, roleConfidence: 1 });
  return {
    id: 'AP-LAYER',
    name: `no-import:${from}->${to}`,
    from,
    to,
    description: '',
    stats: {
      roleFileCount,
      conformingFileCount: roleFileCount - violating,
      violatingFileCount: violating,
      ratio: gate.observedConformance,
      roleConfidence: 1,
    },
    gate,
    violations: [],
    reverseFlow: 4,
  };
};

const baseScan = (overrides: Partial<ScanResult>): ScanResult => ({
  appDir: '/app',
  fileCount: 10,
  aliasCount: 0,
  patterns: [],
  layerBoundaries: [],
  cycles: {
    appDir: '/app',
    fileCount: 10,
    cycles: [],
    filesInCycles: 0,
    gate: evaluateGate({ roleFileCount: 1, violatingFileCount: 0, roleConfidence: 1 }),
  },
  orphans: { appDir: '/app', fileCount: 10, orphans: [] },
  reachability: { appDir: '/app', layers: [], reaches: new Map() },
  publicApi: { appDir: '/app', groups: [] },
  featureSlices: { appDir: '/app', groups: [] },
  testIsolation: {
    appDir: '/app',
    productionFileCount: 0,
    testFileCount: 0,
    offenderCount: 0,
    gate: evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 1 }),
    violations: [],
  },
  appIsolation: { appDir: '/app', groups: [] },
  dependencyInternals: {
    appDir: '/app',
    externalImporterCount: 0,
    offenderCount: 0,
    gate: evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 1 }),
    violations: [],
  },
  roleLayering: { appDir: '/app', boundaries: [] },
  entryPurity: {
    appDir: '/app',
    entryCount: 0,
    offenderCount: 0,
    gate: evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 1 }),
    violations: [],
  },
  phantomDependencies: {
    appDir: '/app',
    externalImporterCount: 0,
    offenderCount: 0,
    gate: evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 1 }),
    violations: [],
  },
  deepRelative: {
    appDir: '/app',
    relativeImporterCount: 0,
    offenderCount: 0,
    gate: evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 1 }),
    violations: [],
  },
  ...overrides,
});

describe('renderReport suggested layer boundaries', () => {
  it('lists the first eight suggested boundaries, an exceptions line, and an overflow count', () => {
    const boundaries = [
      suggestBoundary('a', 'z', 1),
      ...Array.from({ length: 8 }, (_, i) => suggestBoundary(`l${i}`, 'z')),
    ];
    const report = renderReport(baseScan({ layerBoundaries: boundaries }), '9.9.9');
    expect(report).toContain('LAYER BOUNDARIES (suggested)');
    expect(report).toContain('Exceptions: 1');
    expect(report).toContain('... and 1 more');
  });
});

describe('renderReport circular dependencies overflow', () => {
  it('shows only the first five cycles and a remainder count', () => {
    const cycles = Array.from({ length: 6 }, (_, i) => ({ files: [`x${i}.ts`, `y${i}.ts`] }));
    const report = renderReport(
      baseScan({
        cycles: {
          appDir: '/app',
          fileCount: 10,
          cycles,
          filesInCycles: 12,
          gate: evaluateGate({ roleFileCount: 1, violatingFileCount: 0, roleConfidence: 1 }),
        },
      }),
      '9.9.9',
    );
    expect(report).toContain('CIRCULAR DEPENDENCIES (6)');
    expect(report).toContain('... and 1 more');
  });
});
