import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import { detectEnforcers } from '../scanner/enforcers.js';
import { scanRepo } from '../cli/scan.js';
import {
  summarizeRules,
  toScanSummary,
  type RuleSummary,
  type ScanSummary,
} from '../cli/summary.js';
import { buildRecommendations, detectStack, type Recommendations } from '../cli/recommend.js';
import type { DetectedPattern } from '../detector/pattern-detector.js';

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

const localPath = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.toLowerCase().startsWith('file://')) return fileURLToPath(trimmed);
  if (URL_SCHEME.test(trimmed)) {
    throw new Error(
      `"${input}" is a URL, but this server reads directories on the machine it runs on. Clone the repository and pass its directory, or run \`archprint mcp --http\` to scan a public repository by URL.`,
    );
  }
  return trimmed;
};

function resolveAppDirs(input: string): { root: string; dirs: string[] } {
  const root = path.resolve(localPath(input));
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
  rule: RuleSummary;
  pattern?: DetectedPattern;
}

export function explainTool(id: string, input: string): ExplainResult {
  const { root, dirs } = resolveAppDirs(input);
  const wanted = id.toLowerCase();
  const known: string[] = [];
  for (const dir of dirs) {
    const scan = scanRepo(dir, { deep: false });
    const rules = summarizeRules(scan, Number.POSITIVE_INFINITY);
    const rule = rules.find((candidate) => candidate.label.toLowerCase() === wanted);
    if (rule) {
      const pattern = scan.patterns.find(
        (candidate) => candidate.config.id.toLowerCase() === wanted,
      );
      return { app: displayApp(dir, root), rule, ...(pattern && { pattern: pattern.result }) };
    }
    known.push(...rules.map((candidate) => candidate.label));
  }
  throw new Error(
    `No rule "${id}" found under ${path.resolve(input)}. Rules found: ${[...new Set(known)].join(', ') || 'none'}.`,
  );
}
