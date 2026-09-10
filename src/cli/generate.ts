import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GenerationStatus } from '../detector/confidence-gate.js';
import { toDependencyCruiser, toEslintBoundaries } from '../generator/layer-emitters.js';
import { toDependencyCruiserPublicApi } from '../generator/public-api-emitters.js';
import { toDependencyCruiserFeatureSlice } from '../generator/feature-slice-emitters.js';
import {
  toDependencyCruiserTestIsolation,
  toEslintTestIsolation,
} from '../generator/test-isolation-emitters.js';
import { toDependencyCruiserAppIsolation } from '../generator/app-isolation-emitters.js';
import { toDependencyCruiserDependencyInternals } from '../generator/dependency-internals-emitters.js';
import { toDependencyCruiserRoleLayering } from '../generator/role-layering-emitters.js';
import { toDependencyCruiserEntryPurity } from '../generator/entry-purity-emitters.js';
import { toDependencyCruiserPhantomDependencies } from '../generator/phantom-dependency-emitters.js';
import type { InstalledEnforcers } from '../scanner/enforcers.js';
import { toEslintDeepRelative } from '../generator/deep-relative-emitters.js';
import { toEslintConsoleIsolation } from '../generator/console-isolation-emitters.js';
import { toEslintEnvAccess } from '../generator/env-access-emitters.js';
import { toEslintWorkspacePackageApi } from '../generator/workspace-package-emitters.js';
import { toDependencyCruiserStoriesIsolation } from '../generator/stories-isolation-emitters.js';
import { toDependencyCruiserUiData } from '../generator/ui-data-isolation-emitters.js';
import { toDependencyCruiserServerClient } from '../generator/server-client-emitters.js';
import { toGraphviz, toMermaid } from '../generator/graph-emitters.js';
import { renderTsArchTests, type BoundaryRule } from '../generator/tsarch-emitter.js';
import { emitRuleArtifacts } from '../generator/rule-generator.js';
import {
  buildForbiddenImportSpecs,
  renderEslintPluginSource,
} from '../generator/eslint-plugin-emitter.js';
import { renderEslintPreset } from '../generator/eslint-preset-emitter.js';
import {
  mergeNoRestrictedImports,
  type NoRestrictedImportsBlock,
} from '../generator/eslint-scope.js';
import { cleanPreviousOutputs, removeIfEmpty, writeOutputsManifest } from './outputs-manifest.js';
import {
  hasDependencyCruiserBlocks,
  hasEslintOutputs,
  writeDependencyCruiserAggregate,
  writeEslintAggregator,
} from './wiring.js';
import type { ScannedPattern, ScanResult } from './scan.js';

export function writeRules(
  scan: ScanResult,
  outDir: string,
  statuses: readonly GenerationStatus[] = ['AUTO'],
  ids?: readonly string[],
): string[] {
  const wanted = ids ? new Set(ids.map((id) => id.toLowerCase())) : null;
  const written: string[] = [];
  for (const pattern of scan.patterns) {
    if (!statuses.includes(pattern.result.gate.status)) continue;
    if (wanted && !wanted.has(pattern.config.id.toLowerCase())) continue;
    written.push(emitOne(pattern, scan.appDir, outDir));
  }
  return written;
}

export function emitOne(pattern: ScannedPattern, appDir: string, outDir: string): string {
  return emitRuleArtifacts(pattern.config, pattern.result, outDir, `archprint scan ${appDir}`);
}

export function writeLayerConfig(
  scan: ScanResult,
  outDir: string,
  statuses: readonly GenerationStatus[] = ['AUTO'],
): string[] {
  const dependencyCruiser = toDependencyCruiser(scan.layerBoundaries, statuses);
  if (dependencyCruiser.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const write = (name: string, config: unknown): string => {
    const file = path.join(outDir, name);
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    return file;
  };
  return [
    write('dependency-cruiser.archprint.json', dependencyCruiser),
    write('eslint-boundaries.archprint.json', toEslintBoundaries(scan.layerBoundaries, statuses)),
  ];
}

export function writePublicApiConfig(
  scan: ScanResult,
  outDir: string,
  statuses: readonly GenerationStatus[] = ['AUTO'],
): string[] {
  const config = toDependencyCruiserPublicApi(scan.publicApi.groups, statuses);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.public-api.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeFeatureSliceConfig(
  scan: ScanResult,
  outDir: string,
  statuses: readonly GenerationStatus[] = ['AUTO'],
): string[] {
  const config = toDependencyCruiserFeatureSlice(scan.featureSlices.groups, statuses);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.feature-slice.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeAppIsolationConfig(
  scan: ScanResult,
  outDir: string,
  statuses: readonly GenerationStatus[] = ['AUTO'],
): string[] {
  const config = toDependencyCruiserAppIsolation(scan.appIsolation.groups, statuses);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.app-isolation.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeTestIsolationConfig(scan: ScanResult, outDir: string): string[] {
  const config = toDependencyCruiserTestIsolation(scan.testIsolation);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.test-isolation.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeRoleLayeringConfig(
  scan: ScanResult,
  outDir: string,
  statuses: readonly GenerationStatus[] = ['AUTO'],
): string[] {
  const config = toDependencyCruiserRoleLayering(scan.roleLayering.boundaries, statuses);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.role-layering.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeConsoleIsolationConfig(scan: ScanResult, outDir: string): string[] {
  const config = toEslintConsoleIsolation(scan.consoleIsolation);
  if (config === null) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'eslint.console-isolation.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeMergedNoRestrictedImports(
  blocks: readonly (NoRestrictedImportsBlock | null)[],
  outDir: string,
): string[] {
  const merged = mergeNoRestrictedImports(blocks);
  if (merged === null) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'eslint.no-restricted-imports.archprint.json');
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  return [file];
}

export function writeServerClientConfig(scan: ScanResult, outDir: string): string[] {
  const config = toDependencyCruiserServerClient(scan.serverClient);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.server-client.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeUiDataConfig(scan: ScanResult, outDir: string): string[] {
  const config = toDependencyCruiserUiData(scan.uiDataIsolation);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.ui-data.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeStoriesIsolationConfig(scan: ScanResult, outDir: string): string[] {
  const config = toDependencyCruiserStoriesIsolation(scan.storiesIsolation);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.stories-isolation.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeEnvAccessConfig(scan: ScanResult, outDir: string): string[] {
  const config = toEslintEnvAccess(scan.envAccess);
  if (config === null) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'eslint.env-access.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writePhantomDependencyConfig(scan: ScanResult, outDir: string): string[] {
  const config = toDependencyCruiserPhantomDependencies(scan.phantomDependencies);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.phantom-deps.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeEntryPurityConfig(scan: ScanResult, outDir: string): string[] {
  const config = toDependencyCruiserEntryPurity(scan.entryPurity);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.entry-purity.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

export function writeDependencyInternalsConfig(scan: ScanResult, outDir: string): string[] {
  const config = toDependencyCruiserDependencyInternals(scan.dependencyInternals);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.dependency-internals.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return [file];
}

function presetBlocks(scan: ScanResult, structural: boolean): unknown[] {
  const noRestrictedImports: (NoRestrictedImportsBlock | null)[] = [
    toEslintDeepRelative(scan.deepRelative),
    toEslintTestIsolation(scan.testIsolation),
  ];
  if (structural) noRestrictedImports.push(toEslintWorkspacePackageApi(scan.workspacePackageApi));
  const blocks = [
    mergeNoRestrictedImports(noRestrictedImports),
    toEslintConsoleIsolation(scan.consoleIsolation),
  ];
  if (structural) blocks.push(toEslintEnvAccess(scan.envAccess));
  return blocks.filter((block) => block !== null);
}

export function writeEslintPreset(
  scan: ScanResult,
  outDir: string,
  options: { structural?: boolean } = {},
): string[] {
  const specs = buildForbiddenImportSpecs(scan.patterns);
  const blocks = presetBlocks(scan, options.structural ?? false);
  if (specs.length === 0 && blocks.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'eslint-preset.archprint.mjs');
  writeFileSync(file, renderEslintPreset(specs, blocks));
  return [file];
}

export function writeEslintPlugin(scan: ScanResult, outDir: string): string[] {
  const specs = buildForbiddenImportSpecs(scan.patterns);
  if (specs.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'eslint-plugin.archprint.mjs');
  writeFileSync(file, renderEslintPluginSource(specs));
  return [file];
}

export function writeTsArchTests(
  scan: ScanResult,
  outDir: string,
  statuses: readonly GenerationStatus[] = ['AUTO'],
): string[] {
  const rules: BoundaryRule[] = [
    ...toDependencyCruiser(scan.layerBoundaries, statuses).forbidden,
    ...toDependencyCruiserRoleLayering(scan.roleLayering.boundaries, statuses).forbidden,
    ...toDependencyCruiserUiData(scan.uiDataIsolation).forbidden,
  ];
  if (rules.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'architecture.archprint.test.ts');
  writeFileSync(file, renderTsArchTests(rules));
  return [file];
}

export function writeGraph(scan: ScanResult, outDir: string): string[] {
  if (scan.layerBoundaries.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const write = (name: string, content: string): string => {
    const file = path.join(outDir, name);
    writeFileSync(file, `${content}\n`);
    return file;
  };
  return [
    write('layer-graph.archprint.mmd', toMermaid(scan.layerBoundaries)),
    write('layer-graph.archprint.dot', toGraphviz(scan.layerBoundaries)),
  ];
}

export interface WrittenConfig {
  files: string[];
  label: string | null;
}

const countAuto = (items: readonly { gate: { status: GenerationStatus } }[]): number =>
  items.filter((item) => item.gate.status === 'AUTO').length;

export const FAMILY_NAMES = [
  'forbidden-imports',
  'layer',
  'role-layering',
  'public-api',
  'feature-slice',
  'app-isolation',
  'test-isolation',
  'dependency-hygiene',
  'entry-purity',
  'phantom-deps',
  'import-style',
  'console',
  'env-access',
  'workspace-package',
  'stories-isolation',
  'ui-data',
  'server-client',
] as const;

export function writeEnforcementConfigs(
  scan: ScanResult,
  outDir: string,
  options: {
    structural?: boolean;
    enforcers: InstalledEnforcers;
    graph?: boolean;
    only?: string;
    ruleIds?: readonly string[];
  },
): WrittenConfig[] {
  const structural = options.structural ?? false;
  const emitDepcruise = options.enforcers.dependencyCruiser;
  const emitEslint = options.enforcers.eslint || !options.enforcers.dependencyCruiser;
  const pick = (family: string): boolean => !options.only || options.only === family;
  const bundles = options.only === undefined;
  const configs: WrittenConfig[] = [];
  const add = (files: string[], label: string | null): void => {
    if (files.length > 0) configs.push({ files, label });
  };
  const addIf = (condition: boolean, write: () => string[], label: string | null): void => {
    if (condition) add(write(), label);
  };

  addIf(
    emitEslint && pick('forbidden-imports'),
    () => writeRules(scan, outDir, ['AUTO'], options.ruleIds),
    null,
  );
  addIf(
    emitEslint && bundles,
    () => writeEslintPlugin(scan, outDir),
    'forbidden-import rules as a loadable eslint plugin',
  );
  addIf(
    emitEslint && bundles,
    () => writeEslintPreset(scan, outDir, { structural }),
    'shareable single-file eslint preset (portable; needs only eslint)',
  );
  if (structural && emitDepcruise && pick('layer'))
    add(
      writeLayerConfig(scan, outDir, ['AUTO']),
      `${countAuto(scan.layerBoundaries)} layer boundaries: dependency-cruiser and eslint-plugin-boundaries`,
    );
  if (structural && emitDepcruise && pick('role-layering'))
    add(
      writeRoleLayeringConfig(scan, outDir, ['AUTO']),
      `${countAuto(scan.roleLayering.boundaries)} role-layering boundaries: dependency-cruiser rules`,
    );
  addIf(
    emitDepcruise && pick('public-api'),
    () => writePublicApiConfig(scan, outDir, ['AUTO']),
    `${countAuto(scan.publicApi.groups)} public API boundaries: dependency-cruiser deep-import rules`,
  );
  if (structural && emitDepcruise && pick('feature-slice'))
    add(
      writeFeatureSliceConfig(scan, outDir, ['AUTO']),
      `${countAuto(scan.featureSlices.groups)} feature-slice boundaries: dependency-cruiser cross-slice rules`,
    );
  if (structural && emitDepcruise && pick('app-isolation'))
    add(
      writeAppIsolationConfig(scan, outDir, ['AUTO']),
      `${countAuto(scan.appIsolation.groups)} app boundaries: dependency-cruiser cross-app rules`,
    );
  if (pick('test-isolation') && !emitEslint && emitDepcruise)
    add(
      writeTestIsolationConfig(scan, outDir),
      'test isolation: dependency-cruiser not-to-test rule',
    );
  addIf(
    emitDepcruise && pick('dependency-hygiene'),
    () => writeDependencyInternalsConfig(scan, outDir),
    'dependency hygiene: dependency-cruiser no-internals rule',
  );
  if (structural && emitDepcruise && pick('entry-purity'))
    add(
      writeEntryPurityConfig(scan, outDir),
      'entry purity: dependency-cruiser no-import-entry rule',
    );
  if (emitDepcruise && pick('phantom-deps'))
    add(
      writePhantomDependencyConfig(scan, outDir),
      'dependency declaration: dependency-cruiser no-phantom-deps rule',
    );
  const noRestrictedImports: (NoRestrictedImportsBlock | null)[] = [];
  if (emitEslint && pick('import-style'))
    noRestrictedImports.push(toEslintDeepRelative(scan.deepRelative));
  if (emitEslint && pick('test-isolation'))
    noRestrictedImports.push(toEslintTestIsolation(scan.testIsolation));
  if (structural && emitEslint && pick('workspace-package'))
    noRestrictedImports.push(toEslintWorkspacePackageApi(scan.workspacePackageApi));
  add(
    writeMergedNoRestrictedImports(noRestrictedImports, outDir),
    'import boundaries: eslint no-restricted-imports (deep-relative / test / workspace, merged)',
  );
  addIf(
    emitEslint && pick('console'),
    () => writeConsoleIsolationConfig(scan, outDir),
    'console isolation: eslint no-console rule',
  );
  if (structural && emitEslint && pick('env-access'))
    add(writeEnvAccessConfig(scan, outDir), 'env access: eslint no-restricted-properties rule');
  if (structural && emitDepcruise && pick('stories-isolation'))
    add(
      writeStoriesIsolationConfig(scan, outDir),
      'stories isolation: dependency-cruiser no-import-stories rule',
    );
  if (structural && emitDepcruise && pick('ui-data'))
    add(
      writeUiDataConfig(scan, outDir),
      'UI / data separation: dependency-cruiser no-ui-to-data rule',
    );
  if (structural && emitDepcruise && pick('server-client'))
    add(
      writeServerClientConfig(scan, outDir),
      'server / client boundary: dependency-cruiser no-server-only-in-client rule',
    );
  if (structural && bundles)
    add(
      writeTsArchTests(scan, outDir, ['AUTO']),
      'architecture boundaries: ts-arch dependency tests',
    );
  if (options.graph !== false && bundles)
    add(writeGraph(scan, outDir), 'layer dependency graph: Mermaid and Graphviz DOT');
  return configs;
}

export function regenerateConfigs(
  scan: ScanResult,
  outDir: string,
  options: {
    structural?: boolean;
    version: string;
    enforcers: InstalledEnforcers;
    graph?: boolean;
    adoptionReadme?: string;
    only?: string;
    ruleIds?: readonly string[];
  },
): { configs: WrittenConfig[]; removed: string[] } {
  const removed = cleanPreviousOutputs(outDir);
  const configs = writeEnforcementConfigs(scan, outDir, {
    structural: options.structural,
    enforcers: options.enforcers,
    graph: options.graph,
    only: options.only,
    ruleIds: options.ruleIds,
  });
  const allPaths = configs.flatMap((config) => config.files);
  if (hasEslintOutputs(allPaths)) allPaths.push(writeEslintAggregator(outDir));
  if (hasDependencyCruiserBlocks(allPaths)) allPaths.push(writeDependencyCruiserAggregate(outDir));
  if (options.adoptionReadme !== undefined && allPaths.length > 0) {
    const readmePath = path.join(outDir, 'ADOPTION.md');
    writeFileSync(readmePath, options.adoptionReadme);
    allPaths.push(readmePath);
  }
  if (allPaths.length > 0) writeOutputsManifest(outDir, allPaths, options.version);
  else removeIfEmpty(outDir);
  return { configs, removed };
}
