import { existsSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { evaluateGate, REQUEST_ENTRY_ROLES } from '../../src/index.js';
import type {
  AppIsolationAnalysis,
  CycleAnalysis,
  DependencyInternalsAnalysis,
  DetectedPattern,
  EntryPurityAnalysis,
  FeatureSliceAnalysis,
  GenerationStatus,
  LayerBoundary,
  OrphanAnalysis,
  PhantomDependencyAnalysis,
  PublicApiAnalysis,
  ReachabilityAnalysis,
  RoleBoundary,
  RoleLayeringAnalysis,
  TestIsolationAnalysis,
} from '../../src/index.js';
import { scanRepo, type ScannedPattern, type ScanResult } from '../../src/cli/scan.js';
import { renderReport, renderExplain } from '../../src/cli/report.js';
import {
  writeAppIsolationConfig,
  writeDependencyInternalsConfig,
  writeEntryPurityConfig,
  writeFeatureSliceConfig,
  writeGraph,
  writeLayerConfig,
  writePhantomDependencyConfig,
  writePublicApiConfig,
  writeRoleLayeringConfig,
  writeRules,
  writeTestIsolationConfig,
} from '../../src/cli/generate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'ui-infer');

function fakePattern(id: string, status: GenerationStatus): ScannedPattern {
  const violatingFileCount = status === 'AUTO' ? 0 : 4;
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

function emptyCycles(): CycleAnalysis {
  return {
    appDir: 'x',
    fileCount: 0,
    cycles: [],
    filesInCycles: 0,
    gate: evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 1 }),
  };
}

function withCycles(cycleFiles: string[][], fileCount: number): CycleAnalysis {
  const filesInCycles = new Set(cycleFiles.flat()).size;
  return {
    appDir: 'x',
    fileCount,
    cycles: cycleFiles.map((files) => ({ files })),
    filesInCycles,
    gate: evaluateGate({
      roleFileCount: fileCount,
      violatingFileCount: filesInCycles,
      roleConfidence: 1,
    }),
  };
}

function emptyOrphans(): OrphanAnalysis {
  return { appDir: 'x', fileCount: 0, orphans: [] };
}

function emptyReachability(): ReachabilityAnalysis {
  return { appDir: 'x', layers: [], reaches: new Map() };
}

function emptyPublicApi(): PublicApiAnalysis {
  return { appDir: 'x', groups: [] };
}

function emptyFeatureSlices(): FeatureSliceAnalysis {
  return { appDir: 'x', groups: [] };
}

function emptyTestIsolation(): TestIsolationAnalysis {
  return {
    appDir: 'x',
    productionFileCount: 0,
    testFileCount: 0,
    offenderCount: 0,
    gate: evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 1 }),
    violations: [],
  };
}

function emptyAppIsolation(): AppIsolationAnalysis {
  return { appDir: 'x', groups: [] };
}

function fakeDependencyInternals(
  externalImporterCount: number,
  offenderCount: number,
): DependencyInternalsAnalysis {
  return {
    appDir: 'x',
    externalImporterCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: externalImporterCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyDependencyInternals(): DependencyInternalsAnalysis {
  return fakeDependencyInternals(0, 0);
}

function emptyRoleLayering(): RoleLayeringAnalysis {
  return { appDir: 'x', boundaries: [] };
}

function fakeEntryPurity(entryCount: number, offenderCount: number): EntryPurityAnalysis {
  return {
    appDir: 'x',
    entryCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: entryCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyEntryPurity(): EntryPurityAnalysis {
  return fakeEntryPurity(0, 0);
}

function fakePhantom(
  externalImporterCount: number,
  offenderCount: number,
): PhantomDependencyAnalysis {
  return {
    appDir: 'x',
    externalImporterCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: externalImporterCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyPhantom(): PhantomDependencyAnalysis {
  return fakePhantom(0, 0);
}

function emptyScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    appDir: 'x',
    fileCount: 0,
    aliasCount: 0,
    patterns: [],
    layerBoundaries: [],
    cycles: emptyCycles(),
    orphans: emptyOrphans(),
    reachability: emptyReachability(),
    publicApi: emptyPublicApi(),
    featureSlices: emptyFeatureSlices(),
    testIsolation: emptyTestIsolation(),
    appIsolation: emptyAppIsolation(),
    dependencyInternals: emptyDependencyInternals(),
    roleLayering: emptyRoleLayering(),
    entryPurity: emptyEntryPurity(),
    phantomDependencies: emptyPhantom(),
    ...overrides,
  };
}

function fakeRoleBoundary(
  from: RoleBoundary['from'],
  to: RoleBoundary['to'],
  roleFileCount: number,
  violating = 0,
): RoleBoundary {
  const gate = evaluateGate({ roleFileCount, violatingFileCount: violating, roleConfidence: 1 });
  return {
    from,
    to,
    roleFileCount,
    conformingFileCount: roleFileCount - violating,
    violatingFileCount: violating,
    reverseFlow: 20,
    roleConfidence: 1,
    gate,
    violations: [],
  };
}

function fakeAppGroup(container: string, appFileCount: number, crossImporterCount: number) {
  return {
    container,
    appCount: 3,
    appFileCount,
    crossImporterCount,
    gate: evaluateGate({
      roleFileCount: appFileCount,
      violatingFileCount: crossImporterCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function fakeApiGroup(dir: string, consumerCount: number, deepImporterCount: number) {
  return {
    dir,
    internalCount: 4,
    consumerCount,
    deepImporterCount,
    gate: evaluateGate({
      roleFileCount: consumerCount,
      violatingFileCount: deepImporterCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function fakeSliceGroup(container: string, sliceFileCount: number, crossImporterCount: number) {
  return {
    container,
    sliceCount: 3,
    sliceFileCount,
    crossImporterCount,
    gate: evaluateGate({
      roleFileCount: sliceFileCount,
      violatingFileCount: crossImporterCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function fakeTestIsolation(
  productionFileCount: number,
  offenderCount: number,
  testFileCount: number,
): TestIsolationAnalysis {
  return {
    appDir: 'x',
    productionFileCount,
    testFileCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: productionFileCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function fakeLayerBoundary(from: string, to: string, roleFileCount: number): LayerBoundary {
  const gate = evaluateGate({ roleFileCount, violatingFileCount: 0, roleConfidence: 1 });
  return {
    id: 'AP-LAYER',
    name: `no-import:${from}->${to}`,
    from,
    to,
    description: 'layer boundary',
    stats: {
      roleFileCount,
      conformingFileCount: roleFileCount,
      violatingFileCount: 0,
      ratio: 1,
      roleConfidence: 1,
    },
    gate,
    violations: [],
    reverseFlow: 20,
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
    const scan = emptyScan({
      fileCount: 100,
      aliasCount: 2,
      patterns: [fakePattern('AP-002', 'AUTO'), fakePattern('AP-001', 'SUGGEST')],
    });
    const report = renderReport(scan, '1.0.0');
    expect(report).toContain('GENERATED RULES');
    expect(report).toContain('AP-002');
    expect(report).toContain('SUGGESTIONS');
    expect(report).toContain('archprint approve AP-001');
  });

  it('renders inferred layer boundaries in their own section', () => {
    const scan = emptyScan({
      fileCount: 100,
      aliasCount: 1,
      layerBoundaries: [fakeLayerBoundary('shared', 'components', 40)],
    });
    const report = renderReport(scan, '1.0.0');
    expect(report).toContain('LAYER BOUNDARIES');
    expect(report).toContain('shared !-> components');
  });

  it('flags an AUTO layer boundary that leaks transitively through another layer', () => {
    const scan = emptyScan({
      fileCount: 100,
      aliasCount: 1,
      layerBoundaries: [fakeLayerBoundary('utils', 'api', 40)],
      reachability: {
        appDir: 'x',
        layers: ['utils', 'api'],
        reaches: new Map([['utils', new Set(['api'])]]),
      },
    });
    const report = renderReport(scan, '1.0.0');
    expect(report).toContain('Transitive leak');
    expect(report).toContain('utils reaches api through another layer');
  });

  it('renders enforceable dependency hygiene and its offender count when suggested', () => {
    const base = emptyScan({ fileCount: 100, aliasCount: 1 });
    const auto = renderReport(
      { ...base, dependencyInternals: fakeDependencyInternals(40, 0) },
      '1.0.0',
    );
    expect(auto).toContain('DEPENDENCY HYGIENE (enforceable)');

    const suggest = renderReport(
      { ...base, dependencyInternals: fakeDependencyInternals(20, 2) },
      '1.0.0',
    );
    expect(suggest).toContain('DEPENDENCY HYGIENE (suggested)');
    expect(suggest).toContain('Internal imports: 2');

    const none = renderReport(
      { ...base, dependencyInternals: fakeDependencyInternals(0, 0) },
      '1.0.0',
    );
    expect(none).not.toContain('DEPENDENCY HYGIENE');
  });

  it('renders enforceable test isolation and its offender count when suggested', () => {
    const base = emptyScan({ fileCount: 100, aliasCount: 1 });
    const auto = renderReport({ ...base, testIsolation: fakeTestIsolation(40, 0, 3) }, '1.0.0');
    expect(auto).toContain('TEST ISOLATION (enforceable)');

    const suggest = renderReport({ ...base, testIsolation: fakeTestIsolation(20, 2, 3) }, '1.0.0');
    expect(suggest).toContain('TEST ISOLATION (suggested)');
    expect(suggest).toContain('Test imports: 2');

    const none = renderReport({ ...base, testIsolation: fakeTestIsolation(40, 0, 0) }, '1.0.0');
    expect(none).not.toContain('TEST ISOLATION');
  });

  it('renders enforceable and suggested dependency declaration, hidden with no externals', () => {
    const auto = renderReport(emptyScan({ phantomDependencies: fakePhantom(40, 0) }), '1.0.0');
    expect(auto).toContain('DEPENDENCY DECLARATION (enforceable)');
    const suggest = renderReport(emptyScan({ phantomDependencies: fakePhantom(20, 2) }), '1.0.0');
    expect(suggest).toContain('DEPENDENCY DECLARATION (suggested)');
    expect(suggest).toContain('Undeclared (phantom) imports: 2');
    expect(renderReport(emptyScan(), '1.0.0')).not.toContain('DEPENDENCY DECLARATION');
  });

  it('renders enforceable and suggested entry purity, hidden when there are no entries', () => {
    const auto = renderReport(emptyScan({ entryPurity: fakeEntryPurity(40, 0) }), '1.0.0');
    expect(auto).toContain('ENTRY PURITY (enforceable)');
    const suggest = renderReport(emptyScan({ entryPurity: fakeEntryPurity(20, 2) }), '1.0.0');
    expect(suggest).toContain('ENTRY PURITY (suggested)');
    expect(suggest).toContain('Imported entries: 2');
    expect(renderReport(emptyScan(), '1.0.0')).not.toContain('ENTRY PURITY');
  });

  it('renders enforceable and suggested role layering', () => {
    const scan = emptyScan({
      fileCount: 100,
      aliasCount: 1,
      roleLayering: {
        appDir: 'x',
        boundaries: [
          fakeRoleBoundary('REPOSITORY', 'SERVICE', 40, 0),
          fakeRoleBoundary('SERVICE', 'CONTROLLER', 20, 2),
        ],
      },
    });
    const report = renderReport(scan, '1.0.0');
    expect(report).toContain('ROLE LAYERING (enforceable)');
    expect(report).toContain('REPOSITORY !-> SERVICE');
    expect(report).toContain('ROLE LAYERING (suggested)');
    expect(report).toContain('SERVICE !-> CONTROLLER');
  });

  it('renders enforceable and suggested app isolation', () => {
    const scan = emptyScan({
      fileCount: 100,
      aliasCount: 1,
      appIsolation: {
        appDir: 'x',
        groups: [fakeAppGroup('apps', 40, 0), fakeAppGroup('services', 20, 2)],
      },
    });
    const report = renderReport(scan, '1.0.0');
    expect(report).toContain('APP ISOLATION (enforceable)');
    expect(report).toContain('apps (3 apps)');
    expect(report).toContain('APP ISOLATION (suggested)');
    expect(report).toContain('Cross-app imports: 2');
  });

  it('renders enforceable and suggested feature-slice isolation', () => {
    const scan = emptyScan({
      fileCount: 100,
      aliasCount: 1,
      featureSlices: {
        appDir: 'x',
        groups: [fakeSliceGroup('src/features', 40, 0), fakeSliceGroup('src/modules', 20, 2)],
      },
    });
    const report = renderReport(scan, '1.0.0');
    expect(report).toContain('FEATURE SLICE ISOLATION (enforceable)');
    expect(report).toContain('src/features (3 slices)');
    expect(report).toContain('FEATURE SLICE ISOLATION (suggested)');
    expect(report).toContain('Cross-slice imports: 2');
  });

  it('renders enforceable and suggested public API boundaries', () => {
    const scan = emptyScan({
      fileCount: 100,
      aliasCount: 1,
      publicApi: {
        appDir: 'x',
        groups: [fakeApiGroup('features/auth', 40, 0), fakeApiGroup('features/billing', 20, 2)],
      },
    });
    const report = renderReport(scan, '1.0.0');
    expect(report).toContain('PUBLIC API BOUNDARIES (enforceable)');
    expect(report).toContain('features/auth (public API)');
    expect(report).toContain('PUBLIC API BOUNDARIES (suggested)');
    expect(report).toContain('features/billing (public API)');
    expect(report).toContain('Deep imports: 2');
  });

  it('reports circular dependencies when present', () => {
    const scan = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      cycles: withCycles([['a.ts', 'b.ts']], 10),
    });
    const report = renderReport(scan, '1.0.0');
    expect(report).toContain('CIRCULAR DEPENDENCIES');
    expect(report).toContain('a.ts -> b.ts');
  });

  it('reports a clean no-cycles rule when the repo is cycle-free', () => {
    const scan = emptyScan({
      fileCount: 40,
      aliasCount: 1,
      cycles: withCycles([], 40),
    });
    expect(renderReport(scan, '1.0.0')).toContain('No circular dependencies');
  });

  it('reports nothing-generatable and omits the footer in deep mode', () => {
    const empty = emptyScan({ fileCount: 5 });
    const report = renderReport(empty, '1.0.0', 12, true);
    expect(report).toContain('No pattern met the confidence gate');
    expect(report).toContain('(0.0s)');
    expect(report).not.toContain('fast scan at the specifier level');
  });

  it('flags an infrastructure-only exception set with caution', () => {
    const pattern = fakePattern('AP-002', 'SUGGEST');
    pattern.result.infraCaution = true;
    const scan = emptyScan({ fileCount: 1, patterns: [pattern] });
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
    const scan = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      patterns: [fakePattern('AP-002', 'AUTO'), fakePattern('AP-001', 'SUGGEST')],
    });
    const written = writeRules(scan, outDir, ['AUTO']);
    expect(written).toHaveLength(1);
    expect(existsSync(path.join(written[0]!, 'rule-AP-002.ts'))).toBe(true);
    expect(existsSync(path.join(written[0]!, 'fixtures', 'failing.ts'))).toBe(true);
  });

  it('writes a dependency-cruiser config from AUTO layer boundaries', () => {
    rmSync(outDir, { recursive: true, force: true });
    const scan = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      layerBoundaries: [fakeLayerBoundary('utils', 'api', 40)],
    });
    const files = writeLayerConfig(scan, outDir, ['AUTO']);
    expect(files.length).toBe(2);
    const depCruiser = files.find((file) => file.endsWith('dependency-cruiser.archprint.json'))!;
    const config = JSON.parse(readFileSync(depCruiser, 'utf8')) as {
      forbidden: { name: string }[];
    };
    expect(config.forbidden[0]!.name).toBe('no-utils-to-api');
    expect(files.some((file) => file.endsWith('eslint-boundaries.archprint.json'))).toBe(true);
  });

  it('writes a public-API deep-import config for AUTO groups, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const scan = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      publicApi: { appDir: 'x', groups: [fakeApiGroup('features/auth', 40, 0)] },
    });
    const files = writePublicApiConfig(scan, outDir, ['AUTO']);
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-deep-import-features-auth');

    const none: ScanResult = { ...scan, publicApi: emptyPublicApi() };
    expect(writePublicApiConfig(none, outDir, ['AUTO'])).toEqual([]);
  });

  it('writes a feature-slice cross-slice config for AUTO groups, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const scan = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      featureSlices: { appDir: 'x', groups: [fakeSliceGroup('src/features', 40, 0)] },
    });
    const files = writeFeatureSliceConfig(scan, outDir, ['AUTO']);
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-cross-slice-src-features');

    const none: ScanResult = { ...scan, featureSlices: emptyFeatureSlices() };
    expect(writeFeatureSliceConfig(none, outDir, ['AUTO'])).toEqual([]);
  });

  it('writes a phantom-dependency config when all imports are declared, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const files = writePhantomDependencyConfig(
      emptyScan({ phantomDependencies: fakePhantom(40, 0) }),
      outDir,
    );
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-phantom-dependencies');
    expect(writePhantomDependencyConfig(emptyScan(), outDir)).toEqual([]);
  });

  it('writes an entry-purity config when entries are pure, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const files = writeEntryPurityConfig(
      emptyScan({ entryPurity: fakeEntryPurity(40, 0) }),
      outDir,
    );
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-import-framework-entry');
    expect(writeEntryPurityConfig(emptyScan(), outDir)).toEqual([]);
  });

  it('writes a role-layering config for AUTO boundaries, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const scan = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      roleLayering: { appDir: 'x', boundaries: [fakeRoleBoundary('REPOSITORY', 'SERVICE', 40, 0)] },
    });
    const files = writeRoleLayeringConfig(scan, outDir, ['AUTO']);
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-repository-to-service');

    const none: ScanResult = { ...scan, roleLayering: emptyRoleLayering() };
    expect(writeRoleLayeringConfig(none, outDir, ['AUTO'])).toEqual([]);
  });

  it('writes a dependency-internals config when packages are imported cleanly, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const scan = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      dependencyInternals: fakeDependencyInternals(40, 0),
    });
    const files = writeDependencyInternalsConfig(scan, outDir);
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-dependency-internals');

    const none: ScanResult = { ...scan, dependencyInternals: emptyDependencyInternals() };
    expect(writeDependencyInternalsConfig(none, outDir)).toEqual([]);
  });

  it('writes an app-isolation cross-app config for AUTO groups, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const scan = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      appIsolation: { appDir: 'x', groups: [fakeAppGroup('apps', 40, 0)] },
    });
    const files = writeAppIsolationConfig(scan, outDir, ['AUTO']);
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-cross-app-apps');

    const none: ScanResult = { ...scan, appIsolation: emptyAppIsolation() };
    expect(writeAppIsolationConfig(none, outDir, ['AUTO'])).toEqual([]);
  });

  it('writes a test-isolation config when the repo cleanly isolates tests, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const scan = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      testIsolation: fakeTestIsolation(40, 0, 3),
    });
    const files = writeTestIsolationConfig(scan, outDir);
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('not-to-test');

    const none: ScanResult = { ...scan, testIsolation: fakeTestIsolation(40, 0, 0) };
    expect(writeTestIsolationConfig(none, outDir)).toEqual([]);
  });

  it('writes no layer config when there are no AUTO boundaries', () => {
    const scan = emptyScan({ fileCount: 10, aliasCount: 1 });
    expect(writeLayerConfig(scan, outDir, ['AUTO'])).toEqual([]);
  });

  it('writes the mermaid and dot graph whenever there are boundaries, none when there are not', () => {
    rmSync(outDir, { recursive: true, force: true });
    const withBoundaries = emptyScan({
      fileCount: 10,
      aliasCount: 1,
      layerBoundaries: [fakeLayerBoundary('utils', 'api', 10)],
    });
    const files = writeGraph(withBoundaries, outDir);
    expect(files.map((file) => path.basename(file)).sort()).toEqual([
      'layer-graph.archprint.dot',
      'layer-graph.archprint.mmd',
    ]);
    const dot = readFileSync(
      files.find((file) => file.endsWith('.dot'))!,
      'utf8',
    );
    expect(dot).toContain('digraph archprint');

    const none: ScanResult = { ...withBoundaries, layerBoundaries: [] };
    expect(writeGraph(none, outDir)).toEqual([]);
  });
});
