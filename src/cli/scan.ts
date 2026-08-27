import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { listSourceFiles } from '../scanner/file-walker.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import { buildImportGraph } from '../scanner/import-graph.js';
import { type CycleAnalysis, detectCycles } from '../detector/cycle-detector.js';
import { detectLayerBoundaries, type LayerBoundary } from '../detector/layer-detector.js';
import { detectOrphans, type OrphanAnalysis } from '../detector/orphan-detector.js';
import { computeLayerReachability, type ReachabilityAnalysis } from '../detector/reachability.js';
import {
  detectPublicApiBoundaries,
  type PublicApiAnalysis,
} from '../detector/public-api-detector.js';
import {
  detectFeatureSliceIsolation,
  type FeatureSliceAnalysis,
} from '../detector/feature-slice-detector.js';
import {
  detectTestIsolation,
  type TestIsolationAnalysis,
} from '../detector/test-isolation-detector.js';
import {
  detectAppIsolation,
  type AppIsolationAnalysis,
} from '../detector/app-isolation-detector.js';
import {
  detectDependencyInternals,
  type DependencyInternalsAnalysis,
} from '../detector/dependency-internals-detector.js';
import {
  detectRoleLayering,
  type RoleLayeringAnalysis,
} from '../detector/role-layering-detector.js';
import { detectEntryPurity, type EntryPurityAnalysis } from '../detector/entry-purity-detector.js';
import {
  detectPhantomDependencies,
  type PhantomDependencyAnalysis,
} from '../detector/phantom-dependency-detector.js';
import {
  detectDeepRelativeImports,
  type DeepRelativeAnalysis,
} from '../detector/deep-relative-detector.js';
import { scanUsage } from '../scanner/usage-scanner.js';
import {
  detectConsoleIsolation,
  type ConsoleIsolationAnalysis,
} from '../detector/console-isolation-detector.js';
import { detectEnvAccess, type EnvAccessAnalysis } from '../detector/env-access-detector.js';
import {
  detectWorkspacePackageApi,
  type WorkspacePackageAnalysis,
} from '../detector/workspace-package-detector.js';
import { inferDbClientMarkers, inferUiLayerMarkers } from '../detector/marker-inference.js';
import {
  detectForbiddenImports,
  REQUEST_ENTRY_ROLES,
  type DetectedPattern,
  type PatternConfig,
} from '../detector/pattern-detector.js';

export interface ScannedPattern {
  config: PatternConfig;
  result: DetectedPattern;
}

export interface ScanResult {
  appDir: string;
  fileCount: number;
  aliasCount: number;
  patterns: ScannedPattern[];
  layerBoundaries: LayerBoundary[];
  cycles: CycleAnalysis;
  orphans: OrphanAnalysis;
  reachability: ReachabilityAnalysis;
  publicApi: PublicApiAnalysis;
  featureSlices: FeatureSliceAnalysis;
  testIsolation: TestIsolationAnalysis;
  appIsolation: AppIsolationAnalysis;
  dependencyInternals: DependencyInternalsAnalysis;
  roleLayering: RoleLayeringAnalysis;
  entryPurity: EntryPurityAnalysis;
  phantomDependencies: PhantomDependencyAnalysis;
  deepRelative: DeepRelativeAnalysis;
  consoleIsolation: ConsoleIsolationAnalysis;
  envAccess: EnvAccessAnalysis;
  workspacePackageApi: WorkspacePackageAnalysis;
}

export function hasTsConfig(appDir: string): boolean {
  return existsSync(path.join(appDir, 'tsconfig.json'));
}

export function scanRepo(appDir: string, options: { deep?: boolean } = {}): ScanResult {
  const fileCount = listSourceFiles(appDir).length;
  const aliasCount = Object.keys(buildWorkspaceMap(appDir)).length;

  const configs: PatternConfig[] = [];
  const ui = inferUiLayerMarkers(appDir);
  if (ui.markers.length > 0) {
    configs.push({
      id: 'AP-002',
      name: 'no-ui-layer-in-server-entry',
      description: 'A server-entry file must not import from the UI layer.',
      roles: REQUEST_ENTRY_ROLES,
      forbidden: ui.markers,
    });
  }
  configs.push({
    id: 'AP-001',
    name: 'no-db-client-in-request-entry',
    description: 'A request-entry file must not import the database client directly.',
    roles: REQUEST_ENTRY_ROLES,
    forbidden: inferDbClientMarkers(appDir).markers,
  });

  const results = detectForbiddenImports(appDir, configs, { resolve: options.deep ?? false });
  const patterns = configs.map((config, index) => ({ config, result: results[index]! }));
  const layerBoundaries = detectLayerBoundaries(appDir, {
    resolve: options.deep ?? false,
  }).boundaries;
  // Cycles, orphans, reachability, and public-API detection are all structural, so build the first-party
  // graph once (fast: faithful to deep for cycles/orphans/reachability, and required for public-API since
  // deep resolution would resolve through barrels and erase the barrel-vs-deep signal) and share it.
  const graph = buildImportGraph(appDir, { resolve: false });
  const cycles = detectCycles(appDir, { graph });
  const orphans = detectOrphans(appDir, { graph });
  const reachability = computeLayerReachability(appDir, { graph });
  const publicApi = detectPublicApiBoundaries(appDir, { graph });
  const featureSlices = detectFeatureSliceIsolation(appDir, { graph });
  const appIsolation = detectAppIsolation(appDir, { graph });
  const roleLayering = detectRoleLayering(appDir, { graph });
  const entryPurity = detectEntryPurity(appDir, { graph });
  const testIsolation = detectTestIsolation(appDir);
  const dependencyInternals = detectDependencyInternals(appDir);
  const phantomDependencies = detectPhantomDependencies(appDir);
  const deepRelative = detectDeepRelativeImports(appDir);
  const usage = scanUsage(appDir);
  const consoleIsolation = detectConsoleIsolation(appDir, { usage });
  const envAccess = detectEnvAccess(appDir, { usage });
  const workspacePackageApi = detectWorkspacePackageApi(appDir);
  return {
    appDir,
    fileCount,
    aliasCount,
    patterns,
    layerBoundaries,
    cycles,
    orphans,
    reachability,
    publicApi,
    featureSlices,
    testIsolation,
    appIsolation,
    dependencyInternals,
    roleLayering,
    entryPurity,
    phantomDependencies,
    deepRelative,
    consoleIsolation,
    envAccess,
    workspacePackageApi,
  };
}
