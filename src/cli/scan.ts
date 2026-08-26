import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { listSourceFiles } from '../scanner/file-walker.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import { detectLayerBoundaries, type LayerBoundary } from '../detector/layer-detector.js';
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
}

export function hasTsConfig(appDir: string): boolean {
  return existsSync(path.join(appDir, 'tsconfig.json'));
}

/**
 * Run the full pipeline on an app directory: infer this repo's markers, then detect + gate each pattern.
 * `deep` resolves imports through barrels/aliases (slower but catches barrel-hidden imports); the fast
 * default matches at the specifier level.
 */
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
  return { appDir, fileCount, aliasCount, patterns, layerBoundaries };
}
