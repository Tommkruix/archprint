import { emitRuleArtifacts } from '../generator/rule-generator.js';
import type { GenerationStatus } from '../detector/confidence-gate.js';
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
