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
  const confidence = stats.ratio >= 1 ? '100%' : `${(stats.ratio * 100).toFixed(1)}%`;
  const lines = [
    `  ${bold(config.id)}  ${config.name.padEnd(32)} confidence ${confidence}`,
    dim(
      `          Evidence: ${stats.conformingFileCount}/${stats.roleFileCount} server-entry files conform`,
    ),
  ];
  if (stats.violatingFileCount > 0) {
    const caution = infraCaution ? '  (caution: exceptions are infrastructure routes)' : '';
    lines.push(dim(`          Exceptions: ${stats.violatingFileCount}${caution}`));
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
  if (auto.length === 0 && suggest.length === 0) {
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
