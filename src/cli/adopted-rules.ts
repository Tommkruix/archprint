import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GateResult } from '../detector/confidence-gate.js';
import type { Role } from '../scanner/role-classifier.js';
import type { LayerBoundary } from '../detector/layer-detector.js';
import { layerRuleName } from '../generator/layer-emitters.js';
import { DEPENDENCY_INTERNALS_RULE } from '../generator/dependency-internals-emitters.js';
import { ENTRY_PURITY_RULE } from '../generator/entry-purity-emitters.js';
import { PHANTOM_DEPENDENCY_RULE } from '../generator/phantom-dependency-emitters.js';
import { publicApiRuleName } from '../generator/public-api-emitters.js';
import { SERVER_CLIENT_RULE } from '../generator/server-client-emitters.js';
import { configPath, configSection, readConfigSection } from './archprint-config.js';
import { FAMILY_STATEMENTS } from './rule-statements.js';
import type { ScannedPattern, ScanResult } from './scan.js';

/** Where 0.9.0 to 0.11.x kept the adopted rules, before they moved into config.json. */
export const LEGACY_RULES_FILE = 'rules.json';
const LEGACY_RULES_FORMAT = 1;

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
  family:
    | 'test-isolation'
    | 'console-isolation'
    | 'import-style'
    | 'phantom-deps'
    | 'server-client'
    | 'dependency-hygiene'
    | 'entry-purity'
    | 'cycles';
}

export interface LayerRule extends RuleBase {
  family: 'layer';
  from: string;
  to: string;
}

export type AdoptedRule = ForbiddenImportRule | PublicApiRule | LayerRule | SingleFamilyRule;

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

export function phantomDependencyRule(scan: ScanResult): AdoptedRule {
  const analysis = scan.phantomDependencies;
  return {
    id: PHANTOM_DEPENDENCY_RULE,
    family: 'phantom-deps',
    statement: FAMILY_STATEMENTS['phantom-deps'],
    mode: 'fast',
    evidence: evidenceOf(analysis.gate, analysis.externalImporterCount, analysis.offenderCount),
  };
}

export function serverClientRule(scan: ScanResult): AdoptedRule {
  const analysis = scan.serverClient;
  return {
    id: SERVER_CLIENT_RULE,
    family: 'server-client',
    statement: FAMILY_STATEMENTS['server-client'],
    mode: 'fast',
    evidence: evidenceOf(analysis.gate, analysis.clientCount, analysis.offenderCount),
  };
}

export function dependencyInternalsRule(scan: ScanResult): AdoptedRule {
  const analysis = scan.dependencyInternals;
  return {
    id: DEPENDENCY_INTERNALS_RULE,
    family: 'dependency-hygiene',
    statement: FAMILY_STATEMENTS['dependency-hygiene'],
    mode: 'fast',
    evidence: evidenceOf(analysis.gate, analysis.externalImporterCount, analysis.offenderCount),
  };
}

export function entryPurityRule(scan: ScanResult): AdoptedRule {
  const analysis = scan.entryPurity;
  return {
    id: ENTRY_PURITY_RULE,
    family: 'entry-purity',
    statement: FAMILY_STATEMENTS['entry-purity'],
    mode: 'fast',
    evidence: evidenceOf(analysis.gate, analysis.entryCount, analysis.offenderCount),
  };
}

export const NO_CYCLES_RULE = 'no-cycles';

/** Whether the code has no cycle and enough files to say so: only then is no-cycles a rule it follows. */
export const isCycleFree = (scan: ScanResult): boolean =>
  scan.cycles.cycles.length === 0 && scan.cycles.gate.status === 'AUTO';

/** Adopted only while the code has no cycle: then it is a rule the code already follows. */
export function cycleRule(scan: ScanResult): AdoptedRule {
  const analysis = scan.cycles;
  return {
    id: NO_CYCLES_RULE,
    family: 'cycles',
    statement: FAMILY_STATEMENTS.cycles,
    mode: 'fast',
    evidence: evidenceOf(analysis.gate, analysis.fileCount, analysis.filesInCycles),
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

export function layerRule(boundary: LayerBoundary): LayerRule {
  return {
    id: layerRuleName(boundary),
    family: 'layer',
    from: boundary.from,
    to: boundary.to,
    statement: `the ${boundary.from} layer must not import the ${boundary.to} layer`,
    mode: 'fast',
    evidence: evidenceOf(
      boundary.gate,
      boundary.stats.roleFileCount,
      boundary.stats.violatingFileCount,
    ),
  };
}

export const byRuleId = (a: AdoptedRule, b: AdoptedRule): number => a.id.localeCompare(b.id);

export class InvalidRulesError extends Error {}

const FAMILIES: ReadonlySet<string> = new Set([
  'forbidden-imports',
  'public-api',
  'layer',
  'phantom-deps',
  'server-client',
  'dependency-hygiene',
  'entry-purity',
  'cycles',
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
    from?: unknown;
    to?: unknown;
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
  if (
    candidate.family === 'layer' &&
    (typeof candidate.from !== 'string' || typeof candidate.to !== 'string')
  ) {
    return invalid(`rule ${candidate.id} has no layers`);
  }
  return rule as AdoptedRule;
}

function parseRuleList(rules: unknown, file: string): AdoptedRule[] {
  if (!Array.isArray(rules)) {
    throw new InvalidRulesError(
      `${file} was written by a different archprint version. Re-run archprint generate.`,
    );
  }
  return rules.map((rule) => validateRule(rule, file));
}

/** The rules of a legacy rules.json. */
export function parseLegacyRules(text: string, file: string): AdoptedRule[] {
  let parsed: { format?: unknown; rules?: unknown };
  try {
    parsed = JSON.parse(text) as { format?: unknown; rules?: unknown };
  } catch {
    throw new InvalidRulesError(`${file} is not valid JSON. Re-run archprint generate.`);
  }
  return parseRuleList(parsed.format === LEGACY_RULES_FORMAT ? parsed.rules : undefined, file);
}

/** The rules section of config.json text, or null when it has none. */
export function parseConfigRules(text: string, file: string): AdoptedRule[] | null {
  const rules = configSection(text, 'rules');
  return rules === undefined ? null : parseRuleList(rules, file);
}

/** The adopted rules: config.json's rules section, else a legacy rules.json, else null. */
export function readAdoptedRules(outDir: string): AdoptedRule[] | null {
  const rules = readConfigSection(outDir, 'rules');
  if (rules !== undefined) return parseRuleList(rules, configPath(outDir));
  const legacy = path.join(outDir, LEGACY_RULES_FILE);
  return existsSync(legacy) ? parseLegacyRules(readFileSync(legacy, 'utf8'), legacy) : null;
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
    case 'layer':
      return JSON.stringify([...common, rule.from, rule.to]);
    default:
      return JSON.stringify(common);
  }
}
