import type { LayerBoundary } from '../detector/layer-detector.js';
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
  // "confidence" is the Wilson lower bound (the statistical confidence), NOT the observed rate: 9/9 is
  // 100% observed but only ~70% confident. Show both so the number is not misleading.
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

/** Render a scan result as the terminal report. */
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
    for (const boundary of autoLayers) lines.push(...layerLines(boundary));
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

/** Render the gate breakdown and exceptions for a single pattern (the `explain` command). */
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
