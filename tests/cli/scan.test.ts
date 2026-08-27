import { existsSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { evaluateGate, REQUEST_ENTRY_ROLES } from '../../src/index.js';
import type {
  AppIsolationAnalysis,
  ConsoleIsolationAnalysis,
  CycleAnalysis,
  DeepRelativeAnalysis,
  DependencyInternalsAnalysis,
  DetectedPattern,
  EnvAccessAnalysis,
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
  ServerClientAnalysis,
  StoriesIsolationAnalysis,
  TestIsolationAnalysis,
  UiDataIsolationAnalysis,
  WorkspacePackageAnalysis,
} from '../../src/index.js';
import { scanRepo, type ScannedPattern, type ScanResult } from '../../src/cli/scan.js';
import { renderReport, renderExplain } from '../../src/cli/report.js';
import {
  writeAppIsolationConfig,
  writeConsoleIsolationConfig,
  writeDeepRelativeConfig,
  writeDependencyInternalsConfig,
  writeEntryPurityConfig,
  writeEnvAccessConfig,
  writeFeatureSliceConfig,
  writeGraph,
  writeLayerConfig,
  writePhantomDependencyConfig,
  writePublicApiConfig,
  writeRoleLayeringConfig,
  writeRules,
  writeServerClientConfig,
  writeStoriesIsolationConfig,
  writeTestIsolationConfig,
  writeUiDataConfig,
  writeWorkspacePackageConfig,
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

function fakeDeepRelative(
  relativeImporterCount: number,
  offenderCount: number,
): DeepRelativeAnalysis {
  return {
    appDir: 'x',
    relativeImporterCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: relativeImporterCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyDeepRelative(): DeepRelativeAnalysis {
  return fakeDeepRelative(0, 0);
}

function fakeConsole(libraryFileCount: number, offenderCount: number): ConsoleIsolationAnalysis {
  return {
    appDir: 'x',
    libraryFileCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: libraryFileCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyConsole(): ConsoleIsolationAnalysis {
  return fakeConsole(0, 0);
}

function fakeEnv(envUserCount: number, offenderCount: number): EnvAccessAnalysis {
  return {
    appDir: 'x',
    envUserCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: envUserCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyEnv(): EnvAccessAnalysis {
  return fakeEnv(0, 0);
}

function fakeWpkg(consumerCount: number, offenderCount: number): WorkspacePackageAnalysis {
  return {
    appDir: 'x',
    packages: consumerCount > 0 ? ['@scope/pkg'] : [],
    consumerCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: consumerCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyWpkg(): WorkspacePackageAnalysis {
  return fakeWpkg(0, 0);
}

function fakeStories(storyCount: number, offenderCount: number): StoriesIsolationAnalysis {
  return {
    appDir: 'x',
    storyCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: storyCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyStories(): StoriesIsolationAnalysis {
  return fakeStories(0, 0);
}

function fakeUiData(componentCount: number, offenderCount: number): UiDataIsolationAnalysis {
  return {
    appDir: 'x',
    componentCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: componentCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyUiData(): UiDataIsolationAnalysis {
  return fakeUiData(0, 0);
}

function fakeServerClient(clientCount: number, offenderCount: number): ServerClientAnalysis {
  return {
    appDir: 'x',
    clientCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: clientCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

function emptyServerClient(): ServerClientAnalysis {
  return fakeServerClient(0, 0);
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
    deepRelative: emptyDeepRelative(),
    consoleIsolation: emptyConsole(),
    envAccess: emptyEnv(),
    workspacePackageApi: emptyWpkg(),
    storiesIsolation: emptyStories(),
    uiDataIsolation: emptyUiData(),
    serverClient: emptyServerClient(),
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

  it('renders server/client boundary, hidden when there are no client modules', () => {
    expect(renderReport(emptyScan({ serverClient: fakeServerClient(40, 0) }), '1.0.0')).toContain(
      'SERVER / CLIENT BOUNDARY (enforceable)',
    );
    const suggest = renderReport(emptyScan({ serverClient: fakeServerClient(20, 2) }), '1.0.0');
    expect(suggest).toContain('SERVER / CLIENT BOUNDARY (suggested)');
    expect(suggest).toContain('Server-only imports in client code: 2');
    expect(renderReport(emptyScan(), '1.0.0')).not.toContain('SERVER / CLIENT BOUNDARY');
  });

  it('renders UI/data separation, hidden when there are no components', () => {
    expect(renderReport(emptyScan({ uiDataIsolation: fakeUiData(40, 0) }), '1.0.0')).toContain(
      'UI / DATA SEPARATION (enforceable)',
    );
    const suggest = renderReport(emptyScan({ uiDataIsolation: fakeUiData(20, 2) }), '1.0.0');
    expect(suggest).toContain('UI / DATA SEPARATION (suggested)');
    expect(suggest).toContain('Direct data imports: 2');
    expect(renderReport(emptyScan(), '1.0.0')).not.toContain('UI / DATA SEPARATION');
  });

  it('renders stories isolation, hidden when there are no stories', () => {
    expect(renderReport(emptyScan({ storiesIsolation: fakeStories(40, 0) }), '1.0.0')).toContain(
      'STORIES ISOLATION (enforceable)',
    );
    const suggest = renderReport(emptyScan({ storiesIsolation: fakeStories(20, 2) }), '1.0.0');
    expect(suggest).toContain('STORIES ISOLATION (suggested)');
    expect(suggest).toContain('Imported stories: 2');
    expect(renderReport(emptyScan(), '1.0.0')).not.toContain('STORIES ISOLATION');
  });

  it('renders workspace package API, hidden when there are no workspace consumers', () => {
    expect(renderReport(emptyScan({ workspacePackageApi: fakeWpkg(40, 0) }), '1.0.0')).toContain(
      'WORKSPACE PACKAGE API (enforceable)',
    );
    const suggest = renderReport(emptyScan({ workspacePackageApi: fakeWpkg(20, 2) }), '1.0.0');
    expect(suggest).toContain('WORKSPACE PACKAGE API (suggested)');
    expect(suggest).toContain('Deep package imports: 2');
    expect(renderReport(emptyScan(), '1.0.0')).not.toContain('WORKSPACE PACKAGE API');
  });

  it('renders console isolation and env access, hidden when their population is empty', () => {
    expect(renderReport(emptyScan({ consoleIsolation: fakeConsole(40, 0) }), '1.0.0')).toContain(
      'CONSOLE ISOLATION (enforceable)',
    );
    const conSuggest = renderReport(emptyScan({ consoleIsolation: fakeConsole(20, 2) }), '1.0.0');
    expect(conSuggest).toContain('CONSOLE ISOLATION (suggested)');
    expect(conSuggest).toContain('Console usage: 2');
    expect(renderReport(emptyScan({ envAccess: fakeEnv(40, 0) }), '1.0.0')).toContain(
      'ENV ACCESS (enforceable)',
    );
    const envSuggest = renderReport(emptyScan({ envAccess: fakeEnv(20, 2) }), '1.0.0');
    expect(envSuggest).toContain('Reads outside config: 2');
    expect(renderReport(emptyScan(), '1.0.0')).not.toContain('CONSOLE ISOLATION');
    expect(renderReport(emptyScan(), '1.0.0')).not.toContain('ENV ACCESS');
  });

  it('renders enforceable and suggested import style, hidden with no relative imports', () => {
    const auto = renderReport(emptyScan({ deepRelative: fakeDeepRelative(40, 0) }), '1.0.0');
    expect(auto).toContain('IMPORT STYLE (enforceable)');
    const suggest = renderReport(emptyScan({ deepRelative: fakeDeepRelative(20, 2) }), '1.0.0');
    expect(suggest).toContain('IMPORT STYLE (suggested)');
    expect(suggest).toContain('Deep relative imports: 2');
    expect(renderReport(emptyScan(), '1.0.0')).not.toContain('IMPORT STYLE');
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

  it('writes a server-client config when client modules avoid server-only, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const files = writeServerClientConfig(
      emptyScan({ serverClient: fakeServerClient(40, 0) }),
      outDir,
    );
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-server-only-in-client');
    expect(writeServerClientConfig(emptyScan(), outDir)).toEqual([]);
  });

  it('writes a ui-data config when components avoid the data layer, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const files = writeUiDataConfig(emptyScan({ uiDataIsolation: fakeUiData(40, 0) }), outDir);
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-ui-to-data');
    expect(writeUiDataConfig(emptyScan(), outDir)).toEqual([]);
  });

  it('writes a stories-isolation config when stories are unimported, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const files = writeStoriesIsolationConfig(
      emptyScan({ storiesIsolation: fakeStories(40, 0) }),
      outDir,
    );
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as { forbidden: { name: string }[] };
    expect(config.forbidden[0]!.name).toBe('no-import-stories');
    expect(writeStoriesIsolationConfig(emptyScan(), outDir)).toEqual([]);
  });

  it('writes a workspace-package eslint config when packages are imported by name, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    expect(
      writeWorkspacePackageConfig(emptyScan({ workspacePackageApi: fakeWpkg(40, 0) }), outDir),
    ).toHaveLength(1);
    expect(writeWorkspacePackageConfig(emptyScan(), outDir)).toEqual([]);
  });

  it('writes eslint configs for console isolation and env access when clean, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    expect(
      writeConsoleIsolationConfig(emptyScan({ consoleIsolation: fakeConsole(40, 0) }), outDir),
    ).toHaveLength(1);
    expect(writeConsoleIsolationConfig(emptyScan(), outDir)).toEqual([]);
    expect(writeEnvAccessConfig(emptyScan({ envAccess: fakeEnv(40, 0) }), outDir)).toHaveLength(1);
    expect(writeEnvAccessConfig(emptyScan(), outDir)).toEqual([]);
  });

  it('writes a deep-relative eslint config when relative imports are shallow, none otherwise', () => {
    rmSync(outDir, { recursive: true, force: true });
    const files = writeDeepRelativeConfig(
      emptyScan({ deepRelative: fakeDeepRelative(40, 0) }),
      outDir,
    );
    expect(files).toHaveLength(1);
    const config = JSON.parse(readFileSync(files[0]!, 'utf8')) as {
      rules: Record<string, unknown>;
    };
    expect(config.rules['no-restricted-imports']).toBeDefined();
    expect(writeDeepRelativeConfig(emptyScan(), outDir)).toEqual([]);
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
