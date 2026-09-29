import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Recommendation, Recommendations } from './recommend.js';

export const CONFIG_FILE = 'config.json';

export interface ManagedOutputs {
  files: string[];
  readme: boolean;
  readmeCreated: boolean;
  prettierignore: boolean;
  npmignore: boolean;
}

export interface ArchprintConfig {
  archprintVersion: string;
  app: string;
  stack: string[];
  rulesDir: string;
  enforced: Recommendation[];
  review: Recommendation[];
  adopt: Recommendation[];
  evidence: { apps: number; asOf: string };
  managed: ManagedOutputs;
}

const EMPTY_MANAGED: ManagedOutputs = {
  files: [],
  readme: false,
  readmeCreated: false,
  prettierignore: false,
  npmignore: false,
};

function configPath(outDir: string): string {
  return path.join(outDir, CONFIG_FILE);
}

export function buildConfig(
  recommendations: Recommendations,
  version: string,
  location: { app: string; rulesDir: string },
  managed: ManagedOutputs,
): ArchprintConfig {
  return {
    archprintVersion: version,
    app: location.app,
    stack: recommendations.stack,
    rulesDir: location.rulesDir,
    enforced: recommendations.enforceNow,
    review: recommendations.review,
    adopt: recommendations.adopt,
    evidence: recommendations.evidence,
    managed,
  };
}

export function writeConfig(outDir: string, config: ArchprintConfig): string {
  mkdirSync(outDir, { recursive: true });
  const file = configPath(outDir);
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

export function readConfig(outDir: string): ArchprintConfig | null {
  const file = configPath(outDir);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ArchprintConfig>;
    if (typeof parsed.archprintVersion !== 'string') return null;
    return {
      archprintVersion: parsed.archprintVersion,
      app: parsed.app ?? '.',
      stack: parsed.stack ?? [],
      rulesDir: parsed.rulesDir ?? '.archprint',
      enforced: parsed.enforced ?? [],
      review: parsed.review ?? [],
      adopt: parsed.adopt ?? [],
      evidence: parsed.evidence ?? { apps: 0, asOf: '' },
      managed: {
        ...EMPTY_MANAGED,
        ...(parsed.managed ?? {}),
        files: Array.isArray(parsed.managed?.files) ? parsed.managed.files : [],
      },
    };
  } catch {
    return null;
  }
}
