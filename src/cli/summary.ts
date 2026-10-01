import type { GateResult, GenerationStatus } from '../detector/confidence-gate.js';
import type { ScanResult } from './scan.js';
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
  family: string;
  label: string;
  statement: string;
  status: GenerationStatus;
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
  family: string;
  label: string;
  statement: string;
  gate: GateResult;
  files: string[];
}

const filesOf = (violations: readonly { file: string }[]): string[] =>
  [...new Set(violations.map((violation) => violation.file))].sort();

function collectGates(scan: ScanResult): GateEntry[] {
  const entries: GateEntry[] = [];
  for (const pattern of scan.patterns)
    entries.push({
      family: 'forbidden-imports',
      label: pattern.config.id,
      statement: pattern.config.description,
      gate: pattern.result.gate,
      files: filesOf(pattern.result.violations),
    });
  for (const boundary of scan.layerBoundaries)
    entries.push({
      family: 'layer',
      label: `${boundary.from} !-> ${boundary.to}`,
      statement: boundaryStatement(boundary.from, boundary.to),
      gate: boundary.gate,
      files: filesOf(boundary.violations),
    });
  for (const boundary of scan.roleLayering.boundaries)
    entries.push({
      family: 'role-layering',
      label: `${boundary.from} !-> ${boundary.to}`,
      statement: boundaryStatement(boundary.from, boundary.to),
      gate: boundary.gate,
      files: filesOf(boundary.violations),
    });
  for (const group of scan.publicApi.groups)
    entries.push({
      family: 'public-api',
      label: group.dir,
      statement: publicApiStatement(group.dir),
      gate: group.gate,
      files: filesOf(group.violations),
    });
  for (const group of scan.featureSlices.groups)
    entries.push({
      family: 'feature-slice',
      label: group.container,
      statement: sliceStatement(group.container),
      gate: group.gate,
      files: filesOf(group.violations),
    });
  for (const group of scan.appIsolation.groups)
    entries.push({
      family: 'app-isolation',
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
    entries.push({ family, label: family, statement: FAMILY_STATEMENTS[family], gate, files });
  return entries;
}

export function summarizeRules(
  scan: ScanResult,
  exceptionLimit = LISTED_EXCEPTIONS,
): RuleSummary[] {
  return collectGates(scan)
    .filter((entry) => entry.gate.status !== 'REJECT')
    .map(({ family, label, statement, gate, files }) => ({
      family,
      label,
      statement,
      status: gate.status,
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
