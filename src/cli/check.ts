import { existsSync, realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { CONFIG_FILE, readConfig } from './archprint-config.js';
import {
  InvalidRulesError,
  parseAdoptedRules,
  readAdoptedRules,
  RULES_FILE,
  type AdoptedRule,
  type AdoptedRules,
} from './adopted-rules.js';
import { allowKey, readAllowed, type AllowedException } from './allowed-exceptions.js';
import { diffFindings, partitionRules, type RuleChange } from './check-diff.js';
import { evaluateRules, type Finding } from './check-evaluate.js';
import {
  CheckSetupError,
  checkoutBase,
  defaultBase,
  fileAtCommit,
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
      status: 'rules-removed';
      base: string;
      commit: string;
      missingFile: string;
      removed: AdoptedRule[];
    }
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
      allowedInChange: AllowedException[];
      unusedAllows: AllowedException[];
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

function readBaseAllowed(baseOutDir: string): AllowedException[] {
  try {
    return readAllowed(baseOutDir);
  } catch {
    return [];
  }
}

function loadAllowed(outDir: string): AllowedException[] {
  try {
    return readAllowed(outDir);
  } catch (error) {
    throw new CheckSetupError(`cannot read the allowed exceptions: ${(error as Error).message}`);
  }
}

const withoutAllowed = (
  findings: readonly Finding[],
  allowed: readonly AllowedException[],
): Finding[] => {
  const keys = new Set(allowed.map((entry) => allowKey(entry.rule, entry.file)));
  return findings.filter((finding) => !keys.has(allowKey(finding.ruleId, finding.file)));
};

function readBaseRules(baseOutDir: string): AdoptedRules | null {
  try {
    return readAdoptedRules(baseOutDir);
  } catch {
    return null;
  }
}

const outsideRepo = (relative: string): boolean =>
  relative.startsWith('..') || path.isAbsolute(relative);

function insideRepo(root: string, target: string, label: string): string {
  const real = (value: string): string => {
    try {
      return realpathSync(value);
    } catch {
      throw new CheckSetupError(`the ${label} (${target}) does not exist.`);
    }
  };
  const relative = path.relative(real(root), real(target));
  if (outsideRepo(relative)) {
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

function rulesRemovedInChange(options: CheckOptions, missing: string): CheckResult | null {
  if (existsSync(path.resolve(options.cwd, options.out, missing))) return null;
  try {
    const root = realpathSync(repoRoot(options.cwd));
    const relative = path.relative(root, path.resolve(realpathSync(options.cwd), options.out));
    if (outsideRepo(relative)) return null;
    const setupDir = toPosix(relative);
    const base = options.base ?? defaultBase(root);
    const commit = mergeBase(root, base);
    const text = fileAtCommit(root, commit, path.posix.join(setupDir, RULES_FILE));
    if (text === null) return null;
    const removed = parseAdoptedRules(text, RULES_FILE).rules;
    if (removed.length === 0) return null;
    const missingFile = path.posix.join(setupDir, missing);
    return { status: 'rules-removed', base, commit, missingFile, removed };
  } catch (error) {
    if (error instanceof CheckSetupError || error instanceof InvalidRulesError) return null;
    throw error;
  }
}

export function runCheck(options: CheckOptions): CheckResult {
  const outDir = path.resolve(options.cwd, options.out);
  const shown = toPosix(path.relative(options.cwd, outDir) || '.');
  const config = readConfig(outDir);
  if (config === null && options.path === undefined) {
    return (
      rulesRemovedInChange(options, CONFIG_FILE) ?? {
        status: 'skipped',
        reason: `no ${shown}/config.json. Run archprint init (or generate) first.`,
      }
    );
  }
  const adopted = loadRules(outDir);
  const allowed = adopted === null ? [] : loadAllowed(outDir);
  if (adopted === null) {
    return (
      rulesRemovedInChange(options, RULES_FILE) ?? {
        status: 'skipped',
        reason: `no ${shown}/rules.json. Re-run archprint generate once; setups made before 0.9.0 do not have it.`,
      }
    );
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
    const { introduced } = diffFindings(
      baseFindings,
      withoutAllowed(headFindings, allowed),
      renames,
    );
    const { fixed } = diffFindings(baseFindings, headFindings, renames);
    const locate = createLineLocator(appDir);
    const adoptedFindings = evaluateRules(
      appDir,
      partition.adoptedInChange.map((entry) => entry.rule),
    );
    const baseAllowKeys = new Set(
      readBaseAllowed(path.join(baseTree.root, outPrefix)).map((entry) =>
        allowKey(entry.rule, renames.get(entry.file) ?? entry.file),
      ),
    );
    const matchedKeys = new Set(
      [...headFindings, ...adoptedFindings].map((finding) =>
        allowKey(finding.ruleId, finding.file),
      ),
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
      allowedInChange: allowed.filter(
        (entry) =>
          !baseAllowKeys.has(allowKey(entry.rule, entry.file)) &&
          matchedKeys.has(allowKey(entry.rule, entry.file)),
      ),
      unusedAllows: allowed.filter((entry) => !matchedKeys.has(allowKey(entry.rule, entry.file))),
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
  return `${sentence(rule.statement)}. When this rule was adopted, ${conforming} of ${total} files it applies to followed it (confidence ${Math.round(floor * 100)}%).`;
}

const describeSubject = (finding: Finding): string =>
  finding.kind === 'file' ? '' : ` (${finding.subject})`;

const ruleIds = (rules: readonly AdoptedRule[]): string => rules.map((rule) => rule.id).join(', ');

const rulesRemovedMessage = (result: Extract<CheckResult, { status: 'rules-removed' }>): string =>
  `This change removes ${result.missingFile}, so the ${result.removed.length} rule(s) adopted on the base commit are no longer checked: ${ruleIds(result.removed)}.`;

export function renderCheckText(result: CheckResult): string {
  if (result.status === 'skipped') return `archprint check did not run: ${result.reason}`;
  if (result.status === 'rules-removed') return `archprint check: ${rulesRemovedMessage(result)}`;
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
  for (const entry of result.allowedInChange) {
    lines.push(`Allowed in this change: ${entry.rule} in ${entry.file}. Reason: ${entry.reason}`);
  }
  for (const entry of result.unusedAllows) {
    lines.push(
      `Allowed exception no longer needed: ${entry.rule} reports nothing in ${entry.file}. Remove it with archprint allow --remove.`,
    );
  }
  return lines.join('\n');
}

export function checkJson(result: CheckResult, version: string): unknown {
  return { archprintVersion: version, ...checkReport(result) };
}

export function checkReport(result: CheckResult): Record<string, unknown> {
  if (result.status === 'skipped') {
    return { status: 'skipped', reason: result.reason };
  }
  if (result.status === 'rules-removed') {
    return {
      status: 'rules-removed',
      base: result.base,
      commit: result.commit,
      missingFile: result.missingFile,
      removedInChange: result.removed.map((rule) => rule.id),
    };
  }
  const shape = (finding: ReportedFinding) => ({
    rule: finding.rule.id,
    file: finding.file,
    line: finding.line,
    subject: finding.kind === 'file' ? null : finding.subject,
    message: findingMessage(finding.rule),
  });
  return {
    status: 'checked',
    app: result.appPath || '.',
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
    allowedInChange: result.allowedInChange,
    unusedAllows: result.unusedAllows.map(({ rule, file }) => ({ rule, file })),
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
  if (result.status === 'rules-removed') {
    return [
      `::warning file=${escapeProperty(result.missingFile)},title=${escapeProperty('archprint rules removed')}::${escapeData(rulesRemovedMessage(result))}`,
    ];
  }
  const level = failOn === 'new' ? 'error' : 'warning';
  const allowed = result.allowedInChange.map(
    (entry) =>
      `::notice file=${escapeProperty(toPosix(path.posix.join(result.appPath, entry.file)))},title=${escapeProperty(`archprint: ${entry.rule} allowed`)}::${escapeData(`Allowed with a reason: ${entry.reason}`)}`,
  );
  return [
    ...allowed,
    ...result.introduced.map((finding) => {
      const file = toPosix(path.posix.join(result.appPath, finding.file));
      const properties = [`file=${escapeProperty(file)}`];
      if (finding.line !== null) properties.push(`line=${finding.line}`);
      properties.push(`title=${escapeProperty(`archprint: ${finding.rule.id}`)}`);
      return `::${level} ${properties.join(',')}::${escapeData(findingMessage(finding.rule))}`;
    }),
  ];
}

export function githubSummary(result: CheckResult): string {
  if (result.status === 'skipped') {
    return `### archprint check did not run\n\n${result.reason}\n`;
  }
  if (result.status === 'rules-removed') {
    return `### archprint check: rules removed\n\n${rulesRemovedMessage(result)}\n`;
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
  if (result.allowedInChange.length > 0) {
    lines.push(
      '',
      `**Allowed with a reason in this change (${result.allowedInChange.length}):**`,
      '',
    );
    lines.push('| File | Rule | Reason |', '| --- | --- | --- |');
    for (const entry of result.allowedInChange) {
      lines.push(
        `| \`${tableCell(entry.file)}\` | ${tableCell(entry.rule)} | ${tableCell(entry.reason)} |`,
      );
    }
  }
  for (const entry of result.unusedAllows) {
    lines.push(
      '',
      `Allowed exception no longer needed: \`${entry.rule}\` reports nothing in \`${entry.file}\`.`,
    );
  }
  return `${lines.join('\n')}\n`;
}
