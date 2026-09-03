import type { GateResult, GenerationStatus } from '../detector/confidence-gate.js';
import type { ScanResult } from './scan.js';

export interface RuleSummary {
  family: string;
  label: string;
  status: GenerationStatus;
  observedConformance: number;
  confidenceFloor: number;
  observations: number;
  violatingFiles: number;
}

export interface ScanSummary {
  fileCount: number;
  aliasCount: number;
  rules: RuleSummary[];
}

interface GateEntry {
  family: string;
  label: string;
  gate: GateResult;
}

function collectGates(scan: ScanResult): GateEntry[] {
  const entries: GateEntry[] = [];
  for (const pattern of scan.patterns)
    entries.push({
      family: 'forbidden-imports',
      label: pattern.config.id,
      gate: pattern.result.gate,
    });
  for (const boundary of scan.layerBoundaries)
    entries.push({
      family: 'layer',
      label: `${boundary.from} !-> ${boundary.to}`,
      gate: boundary.gate,
    });
  for (const boundary of scan.roleLayering.boundaries)
    entries.push({
      family: 'role-layering',
      label: `${boundary.from} !-> ${boundary.to}`,
      gate: boundary.gate,
    });
  for (const group of scan.publicApi.groups)
    entries.push({ family: 'public-api', label: group.dir, gate: group.gate });
  for (const group of scan.featureSlices.groups)
    entries.push({ family: 'feature-slice', label: group.container, gate: group.gate });
  for (const group of scan.appIsolation.groups)
    entries.push({ family: 'app-isolation', label: group.container, gate: group.gate });
  const singles: [string, GateResult][] = [
    ['cycles', scan.cycles.gate],
    ['test-isolation', scan.testIsolation.gate],
    ['dependency-hygiene', scan.dependencyInternals.gate],
    ['phantom-deps', scan.phantomDependencies.gate],
    ['entry-purity', scan.entryPurity.gate],
    ['import-style', scan.deepRelative.gate],
    ['console-isolation', scan.consoleIsolation.gate],
    ['env-access', scan.envAccess.gate],
    ['workspace-package-api', scan.workspacePackageApi.gate],
    ['stories-isolation', scan.storiesIsolation.gate],
    ['ui-data', scan.uiDataIsolation.gate],
    ['server-client', scan.serverClient.gate],
  ];
  for (const [family, gate] of singles) entries.push({ family, label: family, gate });
  return entries;
}

export function toScanSummary(scan: ScanResult): ScanSummary {
  const rules = collectGates(scan)
    .filter((entry) => entry.gate.status !== 'REJECT')
    .map(({ family, label, gate }) => ({
      family,
      label,
      status: gate.status,
      observedConformance: gate.observedConformance,
      confidenceFloor: gate.conditions.confidence.value,
      observations: gate.observations,
      violatingFiles: gate.conditions.exceptions.value,
    }));
  return { fileCount: scan.fileCount, aliasCount: scan.aliasCount, rules };
}
