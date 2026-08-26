import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GenerationStatus } from '../detector/confidence-gate.js';
import { toDependencyCruiser, toEslintBoundaries } from '../generator/layer-emitters.js';
import { toDependencyCruiserPublicApi } from '../generator/public-api-emitters.js';
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

/**
 * Write the inferred layer boundaries as enforcement configs in each supported ecosystem format
 * (dependency-cruiser and eslint-plugin-boundaries). Returns the file paths written, empty when there are no
 * boundaries at the requested statuses.
 */
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

/**
 * Write the inferred public-API boundaries as a dependency-cruiser deep-import ruleset. Returns the file
 * paths written, empty when no group qualifies at the requested statuses.
 */
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

/**
 * Write the layer dependency graph as Mermaid and Graphviz DOT, so the inferred architecture can be viewed
 * and pasted into docs. Visualizes every interacting layer pair (dominant flow plus leaks), returning the
 * file paths written, or empty when there are no layers.
 */
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
