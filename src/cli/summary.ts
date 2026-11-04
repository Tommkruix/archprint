import type { GateResult, GenerationStatus } from '../detector/confidence-gate.js';
import type { FamilyKey } from '../detector/family-maturity.js';
import { autoTier, type AutoTier } from './recommend.js';
import type { ScanResult } from './scan.js';
import { NO_CYCLES_RULE } from './adopted-rules.js';
import { importPair } from '../generator/eslint-app-emitter.js';
import { appIsolationRuleName } from '../generator/app-isolation-emitters.js';
import { DEPENDENCY_INTERNALS_RULE } from '../generator/dependency-internals-emitters.js';
import { ENTRY_PURITY_RULE } from '../generator/entry-purity-emitters.js';
import { ENV_ACCESS_RULE } from '../generator/env-access-emitters.js';
import { featureSliceRuleName } from '../generator/feature-slice-emitters.js';
import { layerRuleName } from '../generator/layer-emitters.js';
import { PHANTOM_DEPENDENCY_RULE } from '../generator/phantom-dependency-emitters.js';
import { publicApiRuleName } from '../generator/public-api-emitters.js';
import { roleLayeringRuleName } from '../generator/role-layering-emitters.js';
import { SERVER_CLIENT_RULE } from '../generator/server-client-emitters.js';
import { STORIES_ISOLATION_RULE } from '../generator/stories-isolation-emitters.js';
import { UI_DATA_RULE } from '../generator/ui-data-isolation-emitters.js';
import { WORKSPACE_PACKAGE_RULE } from '../generator/workspace-package-emitters.js';
import {
  FAMILY_STATEMENTS,
  appIsolationStatement,
  boundaryStatement,
  publicApiStatement,
  sliceStatement,
  type SingleFamily,
} from './rule-statements.js';

export const LISTED_EXCEPTIONS = 10;

export interface RuleSummary {
  family: FamilyKey;
  /** The rule's id in config.json, `--rules` and its ESLint name (`archprint/<id>`). */
  id: string;
  label: string;
  statement: string;
  status: GenerationStatus;
  adoption: AutoTier;
  observedConformance: number;
  confidenceFloor: number;
  observations: number;
  violatingFiles: number;
  exceptions: string[];
}

export interface ScanSummary {
  fileCount: number;
  aliasCount: number;
  rules: RuleSummary[];
}

interface GateEntry {
  family: FamilyKey;
  id: string;
  label: string;
  statement: string;
  gate: GateResult;
  files: string[];
}

const SINGLE_RULE_IDS: Record<SingleFamily, string> = {
  cycles: NO_CYCLES_RULE,
  'test-isolation': 'test-isolation',
  'dependency-hygiene': DEPENDENCY_INTERNALS_RULE,
  'phantom-deps': PHANTOM_DEPENDENCY_RULE,
  'entry-purity': ENTRY_PURITY_RULE,
  'import-style': 'import-style',
  'console-isolation': 'console-isolation',
  'env-access': ENV_ACCESS_RULE,
  'workspace-package-api': WORKSPACE_PACKAGE_RULE,
  'stories-isolation': STORIES_ISOLATION_RULE,
  'ui-data': UI_DATA_RULE,
  'server-client': SERVER_CLIENT_RULE,
};

const filesOf = (violations: readonly { file: string }[]): string[] =>
  [...new Set(violations.map((violation) => violation.file))].sort();

function collectGates(scan: ScanResult): GateEntry[] {
  const entries: GateEntry[] = [];
  for (const pattern of scan.patterns)
    entries.push({
      family: 'forbidden-imports',
      id: pattern.config.id,
      label: pattern.config.id,
      statement: pattern.config.description,
      gate: pattern.result.gate,
      files: filesOf(pattern.result.violations),
    });
  for (const boundary of scan.layerBoundaries)
    entries.push({
      family: 'layer',
      id: layerRuleName(boundary),
      label: `${boundary.from} !-> ${boundary.to}`,
      statement: boundaryStatement(boundary.from, boundary.to),
      gate: boundary.gate,
      files: filesOf(boundary.violations),
    });
  for (const boundary of scan.roleLayering.boundaries)
    entries.push({
      family: 'role-layering',
      id: roleLayeringRuleName(boundary.from, boundary.to),
      label: `${boundary.from} !-> ${boundary.to}`,
      statement: boundaryStatement(boundary.from, boundary.to),
      gate: boundary.gate,
      files: filesOf(boundary.violations),
    });
  for (const group of scan.publicApi.groups)
    entries.push({
      family: 'public-api',
      id: publicApiRuleName(group.dir),
      label: group.dir,
      statement: publicApiStatement(group.dir),
      gate: group.gate,
      files: filesOf(group.violations),
    });
  for (const group of scan.featureSlices.groups)
    entries.push({
      family: 'feature-slice',
      id: featureSliceRuleName(group.container),
      label: group.container,
      statement: sliceStatement(group.container),
      gate: group.gate,
      files: filesOf(group.violations),
    });
  for (const group of scan.appIsolation.groups)
    entries.push({
      family: 'app-isolation',
      id: appIsolationRuleName(group.container),
      label: group.container,
      statement: appIsolationStatement(group.container),
      gate: group.gate,
      files: filesOf(group.violations),
    });
  const singles: [SingleFamily, GateResult, string[]][] = [
    ['cycles', scan.cycles.gate, [...new Set(scan.cycles.cycles.flatMap((c) => c.files))].sort()],
    ['test-isolation', scan.testIsolation.gate, filesOf(scan.testIsolation.violations)],
    [
      'dependency-hygiene',
      scan.dependencyInternals.gate,
      filesOf(scan.dependencyInternals.violations),
    ],
    ['phantom-deps', scan.phantomDependencies.gate, filesOf(scan.phantomDependencies.violations)],
    ['entry-purity', scan.entryPurity.gate, filesOf(scan.entryPurity.violations)],
    ['import-style', scan.deepRelative.gate, filesOf(scan.deepRelative.violations)],
    ['console-isolation', scan.consoleIsolation.gate, filesOf(scan.consoleIsolation.violations)],
    ['env-access', scan.envAccess.gate, filesOf(scan.envAccess.violations)],
    [
      'workspace-package-api',
      scan.workspacePackageApi.gate,
      filesOf(scan.workspacePackageApi.violations),
    ],
    ['stories-isolation', scan.storiesIsolation.gate, filesOf(scan.storiesIsolation.violations)],
    ['ui-data', scan.uiDataIsolation.gate, filesOf(scan.uiDataIsolation.violations)],
    ['server-client', scan.serverClient.gate, filesOf(scan.serverClient.violations)],
  ];
  for (const [family, gate, files] of singles)
    entries.push({
      family,
      id: SINGLE_RULE_IDS[family],
      label: family,
      statement: FAMILY_STATEMENTS[family],
      gate,
      files,
    });
  return entries;
}

/**
 * What breaks each rule in this scan, any gate status, keyed as `allow` and `check` name it: the file that breaks
 * it, the importing file for stories, and `importer -> entry` for entry purity, which ESLint exempts per import.
 */
export function currentExceptions(scan: ScanResult): Map<string, string[]> {
  const byFamily: Partial<Record<FamilyKey, string[]>> = {
    'entry-purity': scan.entryPurity.imports
      .map(({ importer, file }) => importPair(importer, file))
      .sort(),
    'stories-isolation': [
      ...new Set(scan.storiesIsolation.violations.map((story) => story.importer)),
    ].sort(),
  };
  return new Map(
    collectGates(scan).map((entry) => [entry.id, byFamily[entry.family] ?? entry.files]),
  );
}

export function summarizeRules(
  scan: ScanResult,
  exceptionLimit = LISTED_EXCEPTIONS,
): RuleSummary[] {
  return collectGates(scan)
    .filter((entry) => entry.gate.status !== 'REJECT')
    .map(({ family, id, label, statement, gate, files }) => ({
      family,
      id,
      label,
      statement,
      status: gate.status,
      adoption: gate.status === 'AUTO' ? autoTier(family) : 'review',
      observedConformance: gate.observedConformance,
      confidenceFloor: gate.conditions.confidence.value,
      observations: gate.observations,
      violatingFiles: gate.conditions.exceptions.value,
      exceptions: files.slice(0, exceptionLimit),
    }));
}

export function toScanSummary(scan: ScanResult): ScanSummary {
  return { fileCount: scan.fileCount, aliasCount: scan.aliasCount, rules: summarizeRules(scan) };
}
