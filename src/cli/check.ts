import { existsSync, realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { readConfig } from './archprint-config.js';
import {
  InvalidRulesError,
  readAdoptedRules,
  type AdoptedRule,
  type AdoptedRules,
} from './adopted-rules.js';
import { diffFindings, partitionRules, type RuleChange } from './check-diff.js';
import { evaluateRules, type Finding } from './check-evaluate.js';
import {
  CheckSetupError,
  checkoutBase,
  defaultBase,
  mergeBase,
  renamedPaths,
  repoRoot,
} from './check-git.js';
import { createLineLocator } from './check-locate.js';

export type FailOn = 'none' | 'new';

export interface CheckOptions {
  cwd: string;
  out: string;
  path?: string;
  base?: string;
}

export interface ReportedFinding extends Finding {
  line: number | null;
  rule: AdoptedRule;
}

export interface AdoptedInChange {
  rule: AdoptedRule;
  change: RuleChange;
  count: number;
}

export type CheckResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'checked';
      base: string;
      commit: string;
      appPath: string;
      rules: AdoptedRule[];
      introduced: ReportedFinding[];
      fixed: ReportedFinding[];
      adoptedInChange: AdoptedInChange[];
      removedInChange: AdoptedRule[];
    };

const toPosix = (value: string): string => value.split(path.sep).join('/');

function appRelativeRenames(renames: Map<string, string>, appPrefix: string): Map<string, string> {
  const prefix = appPrefix === '' ? '' : `${appPrefix}/`;
  const mapped = new Map<string, string>();
  for (const [from, to] of renames) {
    if (from.startsWith(prefix) && to.startsWith(prefix)) {
      mapped.set(from.slice(prefix.length), to.slice(prefix.length));
    }
  }
  return mapped;
}

function readBaseRules(baseOutDir: string): AdoptedRules | null {
  try {
    return readAdoptedRules(baseOutDir);
  } catch {
    return null;
  }
}

function insideRepo(root: string, target: string, label: string): string {
  const real = (value: string): string => {
    try {
      return realpathSync(value);
    } catch {
      throw new CheckSetupError(`the ${label} (${target}) does not exist.`);
    }
  };
  const relative = path.relative(real(root), real(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CheckSetupError(`the ${label} (${target}) is outside the repository at ${root}.`);
  }
  return toPosix(relative);
}

function loadRules(outDir: string): AdoptedRules | null {
  try {
    return readAdoptedRules(outDir);
  } catch (error) {
    const reason = error instanceof InvalidRulesError ? error.message : (error as Error).message;
    throw new CheckSetupError(`cannot read the adopted rules: ${reason}`);
  }
}

export function runCheck(options: CheckOptions): CheckResult {
  const outDir = path.resolve(options.cwd, options.out);
  const shown = toPosix(path.relative(options.cwd, outDir) || '.');
  const config = readConfig(outDir);
  if (config === null && options.path === undefined) {
    return {
      status: 'skipped',
      reason: `no ${shown}/config.json. Run archprint init (or generate) first.`,
    };
  }
  const adopted = loadRules(outDir);
  if (adopted === null) {
    return {
      status: 'skipped',
      reason: `no ${shown}/rules.json. Re-run archprint generate once; setups made before 0.9.0 do not have it.`,
    };
  }
  const appDir = path.resolve(options.cwd, options.path ?? config!.app);
  const root = repoRoot(options.cwd);
  const outPrefix = insideRepo(root, outDir, 'rules directory');
  const base = options.base ?? defaultBase(root);
  const commit = mergeBase(root, base);
  const appPrefix = insideRepo(root, appDir, 'app directory');
  if (!statSync(appDir).isDirectory()) {
    throw new CheckSetupError(`the app directory (${appDir}) is not a directory.`);
  }
  const renames = appRelativeRenames(renamedPaths(root, commit), appPrefix);
  const ruleById = new Map(adopted.rules.map((rule) => [rule.id, rule]));

  const baseTree = checkoutBase(root, commit, appPrefix);
  try {
    const baseRules = readBaseRules(path.join(baseTree.root, outPrefix));
    const partition = partitionRules(adopted.rules, baseRules?.rules ?? null);
    const baseApp = path.join(baseTree.root, appPrefix);
    const baseFindings = existsSync(baseApp) ? evaluateRules(baseApp, partition.comparable) : [];
    const headFindings = evaluateRules(appDir, partition.comparable);
    const { introduced, fixed } = diffFindings(baseFindings, headFindings, renames);
    const locate = createLineLocator(appDir);
    const adoptedFindings = evaluateRules(
      appDir,
      partition.adoptedInChange.map((entry) => entry.rule),
    );
    return {
      status: 'checked',
      base,
      commit,
      appPath: appPrefix,
      rules: adopted.rules,
      introduced: introduced.map((finding) => ({
        ...finding,
        line: locate(finding),
        rule: ruleById.get(finding.ruleId)!,
      })),
      fixed: fixed.map((finding) => ({
        ...finding,
        line: null,
        rule: ruleById.get(finding.ruleId)!,
      })),
      adoptedInChange: partition.adoptedInChange.map(({ rule, change }) => ({
        rule,
        change,
        count: adoptedFindings.filter((finding) => finding.ruleId === rule.id).length,
      })),
      removedInChange: partition.removedInChange,
    };
  } finally {
    baseTree.dispose();
  }
}

export function checkExitCode(result: CheckResult, failOn: FailOn): number {
  return result.status === 'checked' && failOn === 'new' && result.introduced.length > 0 ? 1 : 0;
}

const sentence = (text: string): string => {
  const trimmed = text.trim().replace(/\.$/, '');
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

export function findingMessage(rule: AdoptedRule): string {
  const { conforming, total, floor } = rule.evidence;
  return `${sentence(rule.statement)}. When this rule was adopted, ${conforming} of ${total} files followed it (confidence floor ${Math.round(floor * 100)}%).`;
}

const describeSubject = (finding: Finding): string =>
  finding.kind === 'file' ? '' : ` (${finding.subject})`;

export function renderCheckText(result: CheckResult): string {
  if (result.status === 'skipped') return `archprint check did not run: ${result.reason}`;
  const lines = [
    `archprint check against ${result.base} (${result.commit.slice(0, 12)}): ${result.rules.length} adopted rule(s)`,
  ];
  if (result.introduced.length === 0) lines.push('No new violations.');
  for (const finding of result.introduced) {
    const where = finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
    lines.push(`  ${where}  ${finding.rule.id}${describeSubject(finding)}`);
    lines.push(`    ${findingMessage(finding.rule)}`);
  }
  if (result.fixed.length > 0) lines.push(`Fixed: ${result.fixed.length} violation(s) removed.`);
  for (const entry of result.adoptedInChange) {
    lines.push(
      `Rule ${entry.rule.id} was ${entry.change === 'new' ? 'adopted' : 'changed'} in this change (${entry.count} existing violation(s), not counted).`,
    );
  }
  for (const rule of result.removedInChange) {
    lines.push(`Rule ${rule.id} was removed in this change, so it is no longer checked.`);
  }
  return lines.join('\n');
}

export function checkJson(result: CheckResult, version: string): unknown {
  if (result.status === 'skipped') {
    return { archprintVersion: version, status: 'skipped', reason: result.reason };
  }
  const shape = (finding: ReportedFinding) => ({
    rule: finding.rule.id,
    file: finding.file,
    line: finding.line,
    subject: finding.kind === 'file' ? null : finding.subject,
    message: findingMessage(finding.rule),
  });
  return {
    archprintVersion: version,
    status: 'checked',
    base: result.base,
    commit: result.commit,
    introduced: result.introduced.map(shape),
    fixed: result.fixed.map(shape),
    adoptedInChange: result.adoptedInChange.map((entry) => ({
      rule: entry.rule.id,
      change: entry.change,
      existingViolations: entry.count,
    })),
    removedInChange: result.removedInChange.map((rule) => rule.id),
  };
}

const tableCell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const escapeData = (value: string): string =>
  value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const escapeProperty = (value: string): string =>
  escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function githubAnnotations(result: CheckResult, failOn: FailOn): string[] {
  if (result.status === 'skipped') {
    return [
      `::notice title=${escapeProperty('archprint check did not run')}::${escapeData(result.reason)}`,
    ];
  }
  const level = failOn === 'new' ? 'error' : 'warning';
  return result.introduced.map((finding) => {
    const file = toPosix(path.posix.join(result.appPath, finding.file));
    const properties = [`file=${escapeProperty(file)}`];
    if (finding.line !== null) properties.push(`line=${finding.line}`);
    properties.push(`title=${escapeProperty(`archprint: ${finding.rule.id}`)}`);
    return `::${level} ${properties.join(',')}::${escapeData(findingMessage(finding.rule))}`;
  });
}

export function githubSummary(result: CheckResult): string {
  if (result.status === 'skipped') {
    return `### archprint check did not run\n\n${result.reason}\n`;
  }
  const lines = [
    '### archprint check',
    '',
    `Compared with \`${result.base}\` (\`${result.commit.slice(0, 12)}\`) across ${result.rules.length} adopted rule(s).`,
    '',
  ];
  if (result.introduced.length === 0) {
    lines.push('No new violations.');
  } else {
    lines.push(`**${result.introduced.length} new violation(s):**`, '');
    lines.push('| File | Rule | Why |', '| --- | --- | --- |');
    for (const finding of result.introduced) {
      const where = finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
      lines.push(
        `| \`${tableCell(where)}\` | ${tableCell(finding.rule.id)} | ${tableCell(findingMessage(finding.rule))} |`,
      );
    }
    lines.push('', 'Run `npx archprint explain <rule>` locally for the full evidence.');
  }
  if (result.fixed.length > 0)
    lines.push('', `Fixed: ${result.fixed.length} violation(s) removed.`);
  for (const entry of result.adoptedInChange) {
    lines.push(
      '',
      `Rule \`${entry.rule.id}\` was ${entry.change === 'new' ? 'adopted' : 'changed'} in this change; its ${entry.count} existing violation(s) are not counted.`,
    );
  }
  for (const rule of result.removedInChange) {
    lines.push(
      '',
      `Rule \`${rule.id}\` was **removed** in this change, so it is no longer checked.`,
    );
  }
  return `${lines.join('\n')}\n`;
}
