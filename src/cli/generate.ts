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
import { toGraphviz, toMermaid } from '../generator/graph-emitters.js';
import { emitRuleArtifacts } from '../generator/rule-generator.js';
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

export function writeDependencyInternalsConfig(scan: ScanResult, outDir: string): string[] {
  const config = toDependencyCruiserDependencyInternals(scan.dependencyInternals);
  if (config.forbidden.length === 0) return [];
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.dependency-internals.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
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
