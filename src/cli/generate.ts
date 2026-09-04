import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GenerationStatus } from '../detector/confidence-gate.js';
import { toDependencyCruiser, toEslintBoundaries } from '../generator/layer-emitters.js';
import { toDependencyCruiserPublicApi } from '../generator/public-api-emitters.js';
import { toDependencyCruiserFeatureSlice } from '../generator/feature-slice-emitters.js';
import { toDependencyCruiserTestIsolation } from '../generator/test-isolation-emitters.js';
import { toDependencyCruiserAppIsolation } from '../generator/app-isolation-emitters.js';
import { toDependencyCruiserDependencyInternals } from '../generator/dependency-internals-emitters.js';
import { toDependencyCruiserRoleLayering } from '../generator/role-layering-emitters.js';
import { toDependencyCruiserEntryPurity } from '../generator/entry-purity-emitters.js';
import { toDependencyCruiserPhantomDependencies } from '../generator/phantom-dependency-emitters.js';
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
): string[] {
  const written: string[] = [];
  for (const pattern of scan.patterns) {
    if (!statuses.includes(pattern.result.gate.status)) continue;
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

export function writeDeepRelativeConfig(scan: ScanResult, outDir: string): string[] {
  const config = toEslintDeepRelative(scan.deepRelative);
  if (config === null) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'eslint.deep-relative.archprint.json');
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

export function writeWorkspacePackageConfig(scan: ScanResult, outDir: string): string[] {
  const config = toEslintWorkspacePackageApi(scan.workspacePackageApi);
  if (config === null) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'eslint.workspace-package.archprint.json');
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
  const blocks = [
    toEslintDeepRelative(scan.deepRelative),
    toEslintConsoleIsolation(scan.consoleIsolation),
  ];
  if (structural) {
    blocks.push(
      toEslintEnvAccess(scan.envAccess),
      toEslintWorkspacePackageApi(scan.workspacePackageApi),
    );
  }
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

export function writeEnforcementConfigs(
  scan: ScanResult,
  outDir: string,
  options: { structural?: boolean } = {},
): WrittenConfig[] {
  const structural = options.structural ?? false;
  const configs: WrittenConfig[] = [];
  const add = (files: string[], label: string | null): void => {
    if (files.length > 0) configs.push({ files, label });
  };

  add(writeRules(scan, outDir, ['AUTO']), null);
  add(writeEslintPlugin(scan, outDir), 'forbidden-import rules as a loadable eslint plugin');
  add(
    writeEslintPreset(scan, outDir, { structural }),
    'shareable single-file eslint preset (portable; needs only eslint)',
  );
  if (structural) {
    add(
      writeLayerConfig(scan, outDir, ['AUTO']),
      `${countAuto(scan.layerBoundaries)} layer boundaries: dependency-cruiser and eslint-plugin-boundaries`,
    );
    add(
      writeRoleLayeringConfig(scan, outDir, ['AUTO']),
      `${countAuto(scan.roleLayering.boundaries)} role-layering boundaries: dependency-cruiser rules`,
    );
  }
  add(
    writePublicApiConfig(scan, outDir, ['AUTO']),
    `${countAuto(scan.publicApi.groups)} public API boundaries: dependency-cruiser deep-import rules`,
  );
  if (structural) {
    add(
      writeFeatureSliceConfig(scan, outDir, ['AUTO']),
      `${countAuto(scan.featureSlices.groups)} feature-slice boundaries: dependency-cruiser cross-slice rules`,
    );
    add(
      writeAppIsolationConfig(scan, outDir, ['AUTO']),
      `${countAuto(scan.appIsolation.groups)} app boundaries: dependency-cruiser cross-app rules`,
    );
  }
  add(
    writeTestIsolationConfig(scan, outDir),
    'test isolation: dependency-cruiser not-to-test rule',
  );
  add(
    writeDependencyInternalsConfig(scan, outDir),
    'dependency hygiene: dependency-cruiser no-internals rule',
  );
  if (structural)
    add(
      writeEntryPurityConfig(scan, outDir),
      'entry purity: dependency-cruiser no-import-entry rule',
    );
  add(
    writePhantomDependencyConfig(scan, outDir),
    'dependency declaration: dependency-cruiser no-phantom-deps rule',
  );
  add(writeDeepRelativeConfig(scan, outDir), 'import style: eslint no-restricted-imports rule');
  add(writeConsoleIsolationConfig(scan, outDir), 'console isolation: eslint no-console rule');
  if (structural) {
    add(writeEnvAccessConfig(scan, outDir), 'env access: eslint no-restricted-properties rule');
    add(
      writeWorkspacePackageConfig(scan, outDir),
      'workspace package API: eslint no-restricted-imports rule',
    );
    add(
      writeStoriesIsolationConfig(scan, outDir),
      'stories isolation: dependency-cruiser no-import-stories rule',
    );
    add(
      writeUiDataConfig(scan, outDir),
      'UI / data separation: dependency-cruiser no-ui-to-data rule',
    );
    add(
      writeServerClientConfig(scan, outDir),
      'server / client boundary: dependency-cruiser no-server-only-in-client rule',
    );
  }
  if (structural)
    add(
      writeTsArchTests(scan, outDir, ['AUTO']),
      'architecture boundaries: ts-arch dependency tests',
    );
  add(writeGraph(scan, outDir), 'layer dependency graph: Mermaid and Graphviz DOT');
  return configs;
}

export function regenerateConfigs(
  scan: ScanResult,
  outDir: string,
  options: { structural?: boolean; version: string },
): { configs: WrittenConfig[]; removed: string[] } {
  const removed = cleanPreviousOutputs(outDir);
  const configs = writeEnforcementConfigs(scan, outDir, { structural: options.structural });
  const allPaths = configs.flatMap((config) => config.files);
  if (hasEslintOutputs(allPaths)) allPaths.push(writeEslintAggregator(outDir));
  if (hasDependencyCruiserBlocks(allPaths)) allPaths.push(writeDependencyCruiserAggregate(outDir));
  if (allPaths.length > 0) writeOutputsManifest(outDir, allPaths, options.version);
  else removeIfEmpty(outDir);
  return { configs, removed };
}
