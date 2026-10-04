import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GateResult } from '../detector/confidence-gate.js';
import type { Role } from '../scanner/role-classifier.js';
import { publicApiRuleName } from '../generator/public-api-emitters.js';
import { FAMILY_STATEMENTS } from './rule-statements.js';
import type { ScannedPattern, ScanResult } from './scan.js';

export const RULES_FILE = 'rules.json';
export const RULES_FORMAT = 1;

export type ResolutionMode = 'deep' | 'fast';

export interface AdoptionEvidence {
  conforming: number;
  total: number;
  floor: number;
}

interface RuleBase {
  id: string;
  statement: string;
  mode: ResolutionMode;
  evidence: AdoptionEvidence;
}

export interface ForbiddenImportRule extends RuleBase {
  family: 'forbidden-imports';
  roles: Role[];
  forbidden: { source: string; flags: string }[];
}

export interface PublicApiRule extends RuleBase {
  family: 'public-api';
  dir: string;
}

export interface SingleFamilyRule extends RuleBase {
  family: 'test-isolation' | 'console-isolation' | 'import-style';
}

export type AdoptedRule = ForbiddenImportRule | PublicApiRule | SingleFamilyRule;

export interface AdoptedRules {
  format: typeof RULES_FORMAT;
  archprintVersion: string;
  rules: AdoptedRule[];
}

const evidenceOf = (gate: GateResult, total: number, violating: number): AdoptionEvidence => ({
  conforming: total - violating,
  total,
  floor: gate.conditions.confidence.value,
});

export function forbiddenImportRule(pattern: ScannedPattern, mode: ResolutionMode): AdoptedRule {
  const { config, result } = pattern;
  return {
    id: config.id,
    family: 'forbidden-imports',
    statement: config.description,
    mode,
    roles: [...config.roles],
    forbidden: config.forbidden.map((marker) => ({ source: marker.source, flags: marker.flags })),
    evidence: evidenceOf(result.gate, result.stats.roleFileCount, result.stats.violatingFileCount),
  };
}

export function testIsolationRule(scan: ScanResult): AdoptedRule {
  const analysis = scan.testIsolation;
  return {
    id: 'test-isolation',
    family: 'test-isolation',
    statement: FAMILY_STATEMENTS['test-isolation'],
    mode: 'fast',
    evidence: evidenceOf(analysis.gate, analysis.productionFileCount, analysis.offenderCount),
  };
}

export function consoleIsolationRule(scan: ScanResult): AdoptedRule {
  const analysis = scan.consoleIsolation;
  return {
    id: 'console-isolation',
    family: 'console-isolation',
    statement: FAMILY_STATEMENTS['console-isolation'],
    mode: 'fast',
    evidence: evidenceOf(analysis.gate, analysis.libraryFileCount, analysis.offenderCount),
  };
}

export function importStyleRule(scan: ScanResult): AdoptedRule {
  const analysis = scan.deepRelative;
  return {
    id: 'import-style',
    family: 'import-style',
    statement: FAMILY_STATEMENTS['import-style'],
    mode: 'fast',
    evidence: evidenceOf(analysis.gate, analysis.relativeImporterCount, analysis.offenderCount),
  };
}

export function publicApiRules(scan: ScanResult): AdoptedRule[] {
  return scan.publicApi.groups
    .filter((group) => group.gate.status === 'AUTO')
    .map((group) => ({
      id: publicApiRuleName(group.dir),
      family: 'public-api',
      dir: group.dir,
      statement: `import ${group.dir} through its public entry (barrel), not its internal files`,
      mode: 'fast',
      evidence: evidenceOf(group.gate, group.consumerCount, group.deepImporterCount),
    }));
}

export function writeAdoptedRules(
  outDir: string,
  rules: readonly AdoptedRule[],
  archprintVersion: string,
): string {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, RULES_FILE);
  const sorted = [...rules].sort((a, b) => a.id.localeCompare(b.id));
  const content: AdoptedRules = { format: RULES_FORMAT, archprintVersion, rules: sorted };
  writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  return file;
}

export class InvalidRulesError extends Error {}

const FAMILIES: ReadonlySet<string> = new Set([
  'forbidden-imports',
  'public-api',
  'test-isolation',
  'console-isolation',
  'import-style',
]);
const MAX_PATTERN_LENGTH = 200;
const PATTERN_FLAGS = /^[imsu]*$/;

function validateRule(rule: unknown, file: string): AdoptedRule {
  const invalid = (reason: string): never => {
    throw new InvalidRulesError(`${file}: ${reason}. Re-run archprint generate.`);
  };
  if (typeof rule !== 'object' || rule === null) return invalid('a rule is not an object');
  const candidate = rule as {
    id?: unknown;
    family?: unknown;
    mode?: unknown;
    roles?: unknown;
    forbidden?: { source?: unknown; flags?: unknown }[];
    dir?: unknown;
  };
  if (typeof candidate.id !== 'string' || !FAMILIES.has(String(candidate.family))) {
    return invalid('a rule has no valid id or family');
  }
  if (candidate.mode !== 'deep' && candidate.mode !== 'fast') {
    return invalid(`rule ${candidate.id} has no valid resolution mode`);
  }
  if (candidate.family === 'forbidden-imports') {
    const markers = candidate.forbidden;
    if (!Array.isArray(markers) || !Array.isArray(candidate.roles)) {
      return invalid(`rule ${candidate.id} has no roles or forbidden markers`);
    }
    for (const marker of markers) {
      const { source, flags } = marker ?? {};
      if (typeof source !== 'string' || source.length > MAX_PATTERN_LENGTH) {
        return invalid(`rule ${candidate.id} has a missing or oversized pattern`);
      }
      if (typeof flags !== 'string' || !PATTERN_FLAGS.test(flags)) {
        return invalid(`rule ${candidate.id} has unsupported pattern flags`);
      }
      try {
        new RegExp(source, flags);
      } catch {
        return invalid(`rule ${candidate.id} has an invalid pattern`);
      }
    }
  }
  if (candidate.family === 'public-api' && typeof candidate.dir !== 'string') {
    return invalid(`rule ${candidate.id} has no directory`);
  }
  return rule as AdoptedRule;
}

export function readAdoptedRules(outDir: string): AdoptedRules | null {
  const file = path.join(outDir, RULES_FILE);
  return existsSync(file) ? parseAdoptedRules(readFileSync(file, 'utf8'), file) : null;
}

export function parseAdoptedRules(text: string, file: string): AdoptedRules {
  let parsed: Partial<AdoptedRules>;
  try {
    parsed = JSON.parse(text) as Partial<AdoptedRules>;
  } catch {
    throw new InvalidRulesError(`${file} is not valid JSON. Re-run archprint generate.`);
  }
  if (parsed.format !== RULES_FORMAT || !Array.isArray(parsed.rules)) {
    throw new InvalidRulesError(
      `${file} was written by a different archprint version. Re-run archprint generate.`,
    );
  }
  return {
    format: RULES_FORMAT,
    archprintVersion: String(parsed.archprintVersion),
    rules: parsed.rules.map((rule) => validateRule(rule, file)),
  };
}

export function ruleDefinitionKey(rule: AdoptedRule): string {
  const common = [rule.family, rule.id, rule.mode];
  switch (rule.family) {
    case 'forbidden-imports':
      return JSON.stringify([
        ...common,
        [...rule.roles].sort(),
        rule.forbidden.map((marker) => `${marker.source}/${marker.flags}`).sort(),
      ]);
    case 'public-api':
      return JSON.stringify([...common, rule.dir]);
    default:
      return JSON.stringify(common);
  }
}
