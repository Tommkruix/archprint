import type { ScanResult } from '../cli/scan.js';
import type { GateResult } from './confidence-gate.js';

export interface ConsistencyIssue {
  rule: string;
  problem: string;
}

interface EmittedRule {
  label: string;
  gate: GateResult;
  violationFiles: readonly { file: string }[];
}

function emittedRules(scan: ScanResult): EmittedRule[] {
  const out: EmittedRule[] = [];
  for (const p of scan.patterns)
    out.push({
      label: `forbidden-imports:${p.config.id}`,
      gate: p.result.gate,
      violationFiles: p.result.violations,
    });
  for (const b of scan.layerBoundaries)
    out.push({ label: `layer:${b.from}->${b.to}`, gate: b.gate, violationFiles: b.violations });
  for (const g of scan.publicApi.groups)
    out.push({ label: `public-api:${g.dir}`, gate: g.gate, violationFiles: g.violations });
  for (const g of scan.featureSlices.groups)
    out.push({ label: `feature-slice:${g.container}`, gate: g.gate, violationFiles: g.violations });
  for (const g of scan.appIsolation.groups)
    out.push({ label: `app-isolation:${g.container}`, gate: g.gate, violationFiles: g.violations });
  for (const b of scan.roleLayering.boundaries)
    out.push({
      label: `role-layering:${b.from}->${b.to}`,
      gate: b.gate,
      violationFiles: b.violations,
    });
  const singles: readonly [
    string,
    { gate: GateResult; violations: readonly { file: string }[] },
  ][] = [
    ['test-isolation', scan.testIsolation],
    ['dependency-hygiene', scan.dependencyInternals],
    ['phantom-deps', scan.phantomDependencies],
    ['entry-purity', scan.entryPurity],
    ['import-style', scan.deepRelative],
    ['console-isolation', scan.consoleIsolation],
    ['env-access', scan.envAccess],
    ['workspace-package-api', scan.workspacePackageApi],
    ['stories-isolation', scan.storiesIsolation],
    ['ui-data', scan.uiDataIsolation],
    ['server-client', scan.serverClient],
  ];
  for (const [label, a] of singles) out.push({ label, gate: a.gate, violationFiles: a.violations });
  return out;
}

export function checkSelfConsistency(scan: ScanResult): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  for (const rule of emittedRules(scan)) {
    if (rule.gate.status !== 'AUTO') continue;
    if (rule.gate.observations <= 0) {
      issues.push({ rule: rule.label, problem: 'AUTO on an empty population' });
    }
    const recorded = rule.gate.conditions.exceptions.value;
    const listed = new Set(rule.violationFiles.map((v) => v.file)).size;
    if (recorded !== listed) {
      issues.push({
        rule: rule.label,
        problem: `gate records ${recorded} exception file(s) but ${listed} are listed`,
      });
    }
    if (recorded > rule.gate.conditions.exceptions.threshold) {
      issues.push({
        rule: rule.label,
        problem: `AUTO with ${recorded} exceptions, over the ${rule.gate.conditions.exceptions.threshold} budget`,
      });
    }
  }
  return issues;
}
