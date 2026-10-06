import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { writeOwnedFile } from '../generator/owned-paths.js';
import type { AdoptedRule } from './adopted-rules.js';
import type { AllowedException } from './allowed-exceptions.js';
import type { Recommendation, Recommendations } from './recommend.js';

export const CONFIG_FILE = 'config.json';

export interface ManagedOutputs {
  files: string[];
  readme: boolean;
  readmeCreated: boolean;
  prettierignore: boolean;
  prettierignoreCreated: boolean;
  npmignore: boolean;
  npmignoreCreated: boolean;
}

export interface ArchprintConfig {
  archprintVersion: string;
  app: string;
  stack: string[];
  rulesDir: string;
  rules?: AdoptedRule[];
  allowed?: AllowedException[];
  enforced: Recommendation[];
  reportOnly: Recommendation[];
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
  prettierignoreCreated: false,
  npmignore: false,
  npmignoreCreated: false,
};

export function configPath(outDir: string): string {
  return path.join(outDir, CONFIG_FILE);
}

export type ConfigSection = 'rules' | 'allowed';

/** The raw value of a section in config.json text; undefined when the text is not JSON or has no such section. */
export function configSection(text: string, section: ConfigSection): unknown {
  try {
    return (JSON.parse(text) as Partial<Record<ConfigSection, unknown>>)[section];
  } catch {
    return undefined;
  }
}

export function readConfigSection(outDir: string, section: ConfigSection): unknown {
  const file = configPath(outDir);
  return existsSync(file) ? configSection(readFileSync(file, 'utf8'), section) : undefined;
}

export function buildConfig(
  recommendations: Recommendations,
  version: string,
  location: { app: string; rulesDir: string },
  adoption: { rules: AdoptedRule[]; allowed: AllowedException[] },
  managed: ManagedOutputs,
): ArchprintConfig {
  return {
    archprintVersion: version,
    app: location.app,
    stack: recommendations.stack,
    rulesDir: location.rulesDir,
    rules: adoption.rules,
    allowed: adoption.allowed,
    enforced: recommendations.enforceNow,
    reportOnly: recommendations.reportOnly,
    review: recommendations.review,
    adopt: recommendations.adopt,
    evidence: recommendations.evidence,
    managed,
  };
}

export function writeConfig(outDir: string, config: ArchprintConfig): string {
  const file = configPath(outDir);
  writeOwnedFile(outDir, file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

/** Replaces the given sections of config.json, keeping every other key as it is on disk. */
export function updateConfig(outDir: string, sections: Partial<ArchprintConfig>): string {
  const file = configPath(outDir);
  const current = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeOwnedFile(outDir, file, `${JSON.stringify({ ...current, ...sections }, null, 2)}\n`);
  return file;
}

export function recordManagedFiles(
  outDir: string,
  cwd: string,
  version: string,
  absoluteFiles: readonly string[],
): void {
  const relative = absoluteFiles.map((file) => path.relative(cwd, file));
  const existing = readConfig(outDir);
  if (existing) {
    const files = [...new Set([...existing.managed.files, ...relative])];
    updateConfig(outDir, { managed: { ...existing.managed, files } });
    return;
  }
  writeConfig(outDir, {
    archprintVersion: version,
    app: '.',
    stack: [],
    rulesDir: path.relative(cwd, outDir) || outDir,
    enforced: [],
    reportOnly: [],
    review: [],
    adopt: [],
    evidence: { apps: 0, asOf: '' },
    managed: { ...EMPTY_MANAGED, files: relative },
  });
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
      reportOnly: parsed.reportOnly ?? [],
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
