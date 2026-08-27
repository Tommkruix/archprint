import type { LayerBoundary } from '../detector/layer-detector.js';
import type { PublicApiGroup } from '../detector/public-api-detector.js';
import type { FeatureSliceGroup } from '../detector/feature-slice-detector.js';
import type { AppIsolationGroup } from '../detector/app-isolation-detector.js';
import type { RoleBoundary } from '../detector/role-layering-detector.js';
import { reachesLayer } from '../detector/reachability.js';
import type { ScannedPattern, ScanResult } from './scan.js';

const enabled = !process.env.NO_COLOR && process.stdout.isTTY;
const paint =
  (code: string) =>
  (text: string): string =>
    enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const yellow = paint('33');

function patternLines(pattern: ScannedPattern): string[] {
  const { config, result } = pattern;
  const { stats, infraCaution } = result;
  const floor = `${(result.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  const observed = stats.ratio >= 1 ? '100%' : `${(stats.ratio * 100).toFixed(1)}%`;
  const lines = [
    `  ${bold(config.id)}  ${config.name.padEnd(32)} confidence ${floor}`,
    dim(
      `          Evidence: ${stats.conformingFileCount}/${stats.roleFileCount} role files conform (${observed} observed)`,
    ),
  ];
  if (stats.violatingFileCount > 0) {
    const caution = infraCaution ? '  (caution: exceptions are infrastructure routes)' : '';
    lines.push(dim(`          Exceptions: ${stats.violatingFileCount}${caution}`));
  }
  return lines;
}

function layerLines(boundary: LayerBoundary): string[] {
  const floor = `${(boundary.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  const observed =
    boundary.stats.ratio >= 1 ? '100%' : `${(boundary.stats.ratio * 100).toFixed(1)}%`;
  const lines = [
    `  ${bold(`${boundary.from} !-> ${boundary.to}`)}  layer boundary   confidence ${floor}`,
    dim(
      `          Evidence: ${boundary.stats.conformingFileCount}/${boundary.stats.roleFileCount} ${boundary.from} files conform (${observed}); ${boundary.reverseFlow} ${boundary.to} file(s) depend on ${boundary.from}`,
    ),
  ];
  if (boundary.stats.violatingFileCount > 0) {
    lines.push(dim(`          Exceptions: ${boundary.stats.violatingFileCount}`));
  }
  return lines;
}

function apiLines(group: PublicApiGroup): string[] {
  const floor = `${(group.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  const lines = [
    `  ${bold(`${group.dir} (public API)`)}  import via the barrel   confidence ${floor}`,
    dim(
      `          Evidence: ${group.consumerCount - group.deepImporterCount}/${group.consumerCount} external consumers use the barrel; ${group.internalCount} internal file(s)`,
    ),
  ];
  if (group.deepImporterCount > 0) {
    lines.push(dim(`          Deep imports: ${group.deepImporterCount}`));
  }
  return lines;
}

function sliceLines(group: FeatureSliceGroup): string[] {
  const floor = `${(group.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  const lines = [
    `  ${bold(`${group.container} (${group.sliceCount} slices)`)}  slices must not import each other   confidence ${floor}`,
    dim(
      `          Evidence: ${group.sliceFileCount - group.crossImporterCount}/${group.sliceFileCount} slice files stay isolated`,
    ),
  ];
  if (group.crossImporterCount > 0) {
    lines.push(dim(`          Cross-slice imports: ${group.crossImporterCount}`));
  }
  return lines;
}

function appLines(group: AppIsolationGroup): string[] {
  const floor = `${(group.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  const lines = [
    `  ${bold(`${group.container} (${group.appCount} apps)`)}  apps must not import each other   confidence ${floor}`,
    dim(
      `          Evidence: ${group.appFileCount - group.crossImporterCount}/${group.appFileCount} app files stay isolated`,
    ),
  ];
  if (group.crossImporterCount > 0) {
    lines.push(dim(`          Cross-app imports: ${group.crossImporterCount}`));
  }
  return lines;
}

function roleLayerLines(boundary: RoleBoundary): string[] {
  const floor = `${(boundary.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  const lines = [
    `  ${bold(`${boundary.from} !-> ${boundary.to}`)}  role layering   confidence ${floor}`,
    dim(
      `          Evidence: ${boundary.conformingFileCount}/${boundary.roleFileCount} ${boundary.from} files conform; ${boundary.reverseFlow} ${boundary.to} file(s) depend on ${boundary.from}`,
    ),
  ];
  if (boundary.violatingFileCount > 0) {
    lines.push(dim(`          Exceptions: ${boundary.violatingFileCount}`));
  }
  return lines;
}

export function renderReport(
  scan: ScanResult,
  version: string,
  elapsedMs?: number,
  deep = false,
): string {
  const auto = scan.patterns.filter((pattern) => pattern.result.gate.status === 'AUTO');
  const suggest = scan.patterns.filter((pattern) => pattern.result.gate.status === 'SUGGEST');
  const took = elapsedMs === undefined ? '' : ` (${(elapsedMs / 1000).toFixed(1)}s)`;

  const lines = [
    bold(`Archprint v${version}`),
    `Scanned ${scan.fileCount.toLocaleString()} TypeScript files${took}`,
    `Workspace aliases: ${scan.aliasCount} resolved`,
    '',
  ];

  if (auto.length > 0) {
    lines.push(green(bold('GENERATED RULES')));
    for (const pattern of auto) lines.push(...patternLines(pattern));
    lines.push('');
  }
  if (suggest.length > 0) {
    lines.push(yellow(bold('SUGGESTIONS')));
    for (const pattern of suggest) {
      lines.push(...patternLines(pattern));
      lines.push(dim(`          Run: archprint approve ${pattern.config.id}`));
    }
    lines.push('');
  }
  const autoLayers = scan.layerBoundaries.filter((boundary) => boundary.gate.status === 'AUTO');
  const suggestLayers = scan.layerBoundaries.filter(
    (boundary) => boundary.gate.status === 'SUGGEST',
  );
  if (autoLayers.length > 0) {
    lines.push(green(bold('LAYER BOUNDARIES (enforceable)')));
    for (const boundary of autoLayers) {
      lines.push(...layerLines(boundary));
      // A direct-clean boundary can still leak through an intermediary layer; a plain import rule would not
      // catch that, so flag it and point at the stronger transitive (dependency-cruiser reachable) form.
      if (reachesLayer(scan.reachability, boundary.from, boundary.to)) {
        lines.push(
          yellow(
            `          Transitive leak: ${boundary.from} reaches ${boundary.to} through another layer (needs a reachability rule).`,
          ),
        );
      }
    }
    lines.push('');
  }
  if (suggestLayers.length > 0) {
    lines.push(yellow(bold('LAYER BOUNDARIES (suggested)')));
    for (const boundary of suggestLayers.slice(0, 8)) lines.push(...layerLines(boundary));
    if (suggestLayers.length > 8) {
      lines.push(dim(`          ... and ${suggestLayers.length - 8} more`));
    }
    lines.push('');
  }
  const autoRoles = scan.roleLayering.boundaries.filter((b) => b.gate.status === 'AUTO');
  const suggestRoles = scan.roleLayering.boundaries.filter((b) => b.gate.status === 'SUGGEST');
  if (autoRoles.length > 0) {
    lines.push(green(bold('ROLE LAYERING (enforceable)')));
    for (const boundary of autoRoles) lines.push(...roleLayerLines(boundary));
    lines.push('');
  }
  if (suggestRoles.length > 0) {
    lines.push(yellow(bold('ROLE LAYERING (suggested)')));
    for (const boundary of suggestRoles.slice(0, 8)) lines.push(...roleLayerLines(boundary));
    if (suggestRoles.length > 8) {
      lines.push(dim(`          ... and ${suggestRoles.length - 8} more`));
    }
    lines.push('');
  }
  if (scan.cycles.cycles.length > 0) {
    lines.push(yellow(bold(`CIRCULAR DEPENDENCIES (${scan.cycles.cycles.length})`)));
    for (const cycle of scan.cycles.cycles.slice(0, 5)) {
      lines.push(dim(`  ${cycle.files.join(' -> ')}`));
    }
    if (scan.cycles.cycles.length > 5) {
      lines.push(dim(`  ... and ${scan.cycles.cycles.length - 5} more`));
    }
    lines.push('');
  } else if (scan.cycles.gate.status === 'AUTO') {
    lines.push(green('No circular dependencies (the no-cycles rule is enforceable).'), '');
  }
  if (scan.orphans.orphans.length > 0) {
    lines.push(
      yellow(bold(`ORPHAN MODULES (${scan.orphans.orphans.length}, review before deleting)`)),
    );
    for (const orphan of scan.orphans.orphans.slice(0, 8)) {
      lines.push(dim(`  ${orphan}`));
    }
    if (scan.orphans.orphans.length > 8) {
      lines.push(dim(`  ... and ${scan.orphans.orphans.length - 8} more`));
    }
    lines.push(
      dim(
        '  Nothing imports these and they are not framework entries. Suggest only, not enforced.',
      ),
    );
    lines.push('');
  }
  const autoApi = scan.publicApi.groups.filter((g) => g.gate.status === 'AUTO');
  const suggestApi = scan.publicApi.groups.filter((g) => g.gate.status === 'SUGGEST');
  if (autoApi.length > 0) {
    lines.push(green(bold('PUBLIC API BOUNDARIES (enforceable)')));
    for (const g of autoApi) lines.push(...apiLines(g));
    lines.push('');
  }
  if (suggestApi.length > 0) {
    lines.push(yellow(bold('PUBLIC API BOUNDARIES (suggested)')));
    for (const g of suggestApi.slice(0, 8)) lines.push(...apiLines(g));
    if (suggestApi.length > 8) lines.push(dim(`          ... and ${suggestApi.length - 8} more`));
    lines.push('');
  }
  const autoSlices = scan.featureSlices.groups.filter((g) => g.gate.status === 'AUTO');
  const suggestSlices = scan.featureSlices.groups.filter((g) => g.gate.status === 'SUGGEST');
  if (autoSlices.length > 0) {
    lines.push(green(bold('FEATURE SLICE ISOLATION (enforceable)')));
    for (const g of autoSlices) lines.push(...sliceLines(g));
    lines.push('');
  }
  if (suggestSlices.length > 0) {
    lines.push(yellow(bold('FEATURE SLICE ISOLATION (suggested)')));
    for (const g of suggestSlices.slice(0, 8)) lines.push(...sliceLines(g));
    if (suggestSlices.length > 8) {
      lines.push(dim(`          ... and ${suggestSlices.length - 8} more`));
    }
    lines.push('');
  }
  const autoApps = scan.appIsolation.groups.filter((g) => g.gate.status === 'AUTO');
  const suggestApps = scan.appIsolation.groups.filter((g) => g.gate.status === 'SUGGEST');
  if (autoApps.length > 0) {
    lines.push(green(bold('APP ISOLATION (enforceable)')));
    for (const g of autoApps) lines.push(...appLines(g));
    lines.push('');
  }
  if (suggestApps.length > 0) {
    lines.push(yellow(bold('APP ISOLATION (suggested)')));
    for (const g of suggestApps.slice(0, 8)) lines.push(...appLines(g));
    if (suggestApps.length > 8) {
      lines.push(dim(`          ... and ${suggestApps.length - 8} more`));
    }
    lines.push('');
  }
  const testIso = scan.testIsolation;
  if (
    testIso.testFileCount > 0 &&
    (testIso.gate.status === 'AUTO' || testIso.gate.status === 'SUGGEST')
  ) {
    const label = testIso.gate.status === 'AUTO' ? green : yellow;
    const suffix = testIso.gate.status === 'AUTO' ? '(enforceable)' : '(suggested)';
    const floor = `${(testIso.gate.conditions.confidence.value * 100).toFixed(0)}%`;
    lines.push(label(bold(`TEST ISOLATION ${suffix}`)));
    lines.push(`  production code must not import test files   confidence ${floor}`);
    lines.push(
      dim(
        `          Evidence: ${testIso.productionFileCount - testIso.offenderCount}/${testIso.productionFileCount} production files stay clean of ${testIso.testFileCount} test file(s)`,
      ),
    );
    if (testIso.offenderCount > 0) {
      lines.push(dim(`          Test imports: ${testIso.offenderCount}`));
    }
    lines.push('');
  }
  const deps = scan.dependencyInternals;
  if (
    deps.externalImporterCount > 0 &&
    (deps.gate.status === 'AUTO' || deps.gate.status === 'SUGGEST')
  ) {
    const label = deps.gate.status === 'AUTO' ? green : yellow;
    const suffix = deps.gate.status === 'AUTO' ? '(enforceable)' : '(suggested)';
    const floor = `${(deps.gate.conditions.confidence.value * 100).toFixed(0)}%`;
    lines.push(label(bold(`DEPENDENCY HYGIENE ${suffix}`)));
    lines.push(
      `  import dependencies by their public entry, not their internals   confidence ${floor}`,
    );
    lines.push(
      dim(
        `          Evidence: ${deps.externalImporterCount - deps.offenderCount}/${deps.externalImporterCount} files importing packages avoid their build/impl dirs`,
      ),
    );
    if (deps.offenderCount > 0) {
      lines.push(dim(`          Internal imports: ${deps.offenderCount}`));
    }
    lines.push('');
  }
  const entry = scan.entryPurity;
  if (entry.entryCount > 0 && (entry.gate.status === 'AUTO' || entry.gate.status === 'SUGGEST')) {
    const label = entry.gate.status === 'AUTO' ? green : yellow;
    const suffix = entry.gate.status === 'AUTO' ? '(enforceable)' : '(suggested)';
    const floor = `${(entry.gate.conditions.confidence.value * 100).toFixed(0)}%`;
    lines.push(label(bold(`ENTRY PURITY ${suffix}`)));
    lines.push(`  framework entries must not be imported by other code   confidence ${floor}`);
    lines.push(
      dim(
        `          Evidence: ${entry.entryCount - entry.offenderCount}/${entry.entryCount} framework entries are imported by nothing`,
      ),
    );
    if (entry.offenderCount > 0) {
      lines.push(dim(`          Imported entries: ${entry.offenderCount}`));
    }
    lines.push('');
  }
  if (
    auto.length === 0 &&
    suggest.length === 0 &&
    autoLayers.length === 0 &&
    suggestLayers.length === 0
  ) {
    lines.push(dim('No pattern met the confidence gate (conservative by design).'));
    lines.push('');
  }

  lines.push(
    auto.length > 0
      ? dim('Run: archprint generate  to write the ESLint rule files.')
      : dim('Nothing to generate.'),
  );
  if (!deep) {
    lines.push(
      dim('(fast scan at the specifier level; run with --deep to resolve barrels and aliases.)'),
    );
  }
  return lines.join('\n');
}

export function renderExplain(pattern: ScannedPattern): string {
  const { config, result } = pattern;
  const lines = [
    bold(`${config.id}  ${config.name}`),
    config.description,
    '',
    `Status: ${result.gate.status}`,
    'Gate:',
  ];
  for (const [name, condition] of Object.entries(result.gate.conditions)) {
    const mark = condition.pass ? green('PASS') : yellow('FAIL');
    lines.push(
      `  [${mark}] ${name.padEnd(15)} ${String(condition.value).padStart(6)}   threshold ${condition.threshold}`,
    );
  }
  lines.push(
    dim(
      `  observations: ${result.gate.observations} (${(result.gate.observedConformance * 100).toFixed(1)}% conforming); confidence floor is the Wilson 95% lower bound`,
    ),
  );
  if (result.violations.length > 0) {
    lines.push('', 'Exceptions:');
    for (const violation of result.violations.slice(0, 10)) {
      lines.push(dim(`  ${violation.file}  ->  ${violation.specifier}`));
    }
    if (result.violations.length > 10)
      lines.push(dim(`  ... and ${result.violations.length - 10} more`));
  }
  return lines.join('\n');
}
