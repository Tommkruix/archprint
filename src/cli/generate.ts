import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GenerationStatus } from '../detector/confidence-gate.js';
import { toDependencyCruiser } from '../generator/layer-emitters.js';
import { emitRuleArtifacts } from '../generator/rule-generator.js';
import type { ScannedPattern, ScanResult } from './scan.js';

/** Emit the four artifacts for every pattern whose gate status is in `statuses`. Returns the dirs written. */
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

/** Emit the four artifacts for a single pattern. */
export function emitOne(pattern: ScannedPattern, appDir: string, outDir: string): string {
  return emitRuleArtifacts(pattern.config, pattern.result, outDir, `archprint scan ${appDir}`);
}

/**
 * Write the inferred layer boundaries as a dependency-cruiser config. Returns the file path, or null when
 * there are no boundaries at the requested statuses.
 */
export function writeLayerConfig(
  scan: ScanResult,
  outDir: string,
  statuses: readonly GenerationStatus[] = ['AUTO'],
): string | null {
  const config = toDependencyCruiser(scan.layerBoundaries, statuses);
  if (config.forbidden.length === 0) return null;
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'dependency-cruiser.archprint.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}
