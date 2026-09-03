import { writeFileSync } from 'node:fs';
import { type Recommendation, type Recommendations } from './recommend.js';

export const INIT_MANIFEST_FILE = 'archprint.json';

export interface InitManifest {
  archprintVersion: string;
  app: string;
  stack: string[];
  rulesDir: string;
  enforced: Recommendation[];
  review: Recommendation[];
  adopt: Recommendation[];
  evidence: { apps: number; asOf: string };
}

export function buildInitManifest(
  recommendations: Recommendations,
  version: string,
  location: { app: string; rulesDir: string },
): InitManifest {
  return {
    archprintVersion: version,
    app: location.app,
    stack: recommendations.stack,
    rulesDir: location.rulesDir,
    enforced: recommendations.enforceNow,
    review: recommendations.review,
    adopt: recommendations.adopt,
    evidence: recommendations.evidence,
  };
}

export function writeInitManifest(manifest: InitManifest, manifestPath: string): void {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
