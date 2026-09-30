import * as path from 'node:path';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import { detectEnforcers } from '../scanner/enforcers.js';
import { scanRepo } from '../cli/scan.js';
import { toScanSummary, type ScanSummary } from '../cli/summary.js';
import { buildRecommendations, detectStack, type Recommendations } from '../cli/recommend.js';
import type { DetectedPattern } from '../detector/pattern-detector.js';

function resolveAppDirs(input: string): { root: string; dirs: string[] } {
  const root = path.resolve(input);
  const dirs = discoverAppDirs(root);
  if (dirs.length === 0) {
    throw new Error(
      `No tsconfig.json found under ${root}. Point archprint at an app directory (a directory with a tsconfig.json); a monorepo root is fine.`,
    );
  }
  return { root, dirs };
}

const displayApp = (dir: string, root: string): string => path.relative(root, dir) || '.';

export interface AppScan extends ScanSummary {
  app: string;
}

export function scanTool(input: string, deep = false): AppScan[] {
  const { root, dirs } = resolveAppDirs(input);
  return dirs.map((dir) => ({
    app: displayApp(dir, root),
    ...toScanSummary(scanRepo(dir, { deep })),
  }));
}

export interface AppRecommendations extends Recommendations {
  app: string;
}

export function recommendTool(input: string): AppRecommendations[] {
  const { root, dirs } = resolveAppDirs(input);
  return dirs.map((dir) => ({
    app: displayApp(dir, root),
    ...buildRecommendations(scanRepo(dir, { deep: false }), detectStack(dir), detectEnforcers(dir)),
  }));
}

export interface ExplainResult {
  app: string;
  pattern: DetectedPattern;
}

export function explainTool(id: string, input: string): ExplainResult {
  const { root, dirs } = resolveAppDirs(input);
  for (const dir of dirs) {
    const pattern = scanRepo(dir, { deep: false }).patterns.find(
      (candidate) => candidate.config.id.toLowerCase() === id.toLowerCase(),
    );
    if (pattern) return { app: displayApp(dir, root), pattern: pattern.result };
  }
  throw new Error(`No pattern "${id}" found under ${path.resolve(input)}.`);
}
