import * as path from 'node:path';
import {
  type DeclaredMeasure,
  type DeclaredViolation,
  loadCodebase,
  measureDeclared,
  type PackageTarget,
} from '../detector/declared-rules.js';
import type { GenerationStatus } from '../detector/confidence-gate.js';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import {
  type DeclaredRule,
  declaredRuleId,
  type InferredSentence,
  isDeclaredRule,
  type MappingEntry,
  parseMapping,
  type SentenceSource,
} from './declared-mapping.js';
import type { AutoTier } from './recommend.js';
import { findRule } from './rule-ref.js';
import { scanRepo } from './scan.js';
import { type RuleSummary, summarizeRules } from './summary.js';
import { locateQuote } from './source-quote.js';

export type GapStatus =
  'enforce-now' | 'baseline' | 'inferred' | 'no-match' | 'quote-not-found' | 'invalid' | 'guidance';

export interface GapEvidence {
  files: number;
  following: number;
  /** Files outside the scope that do what the rule forbids. */
  elsewhere: number;
  /** Nothing in the code, in scope or out, does what the rule forbids, so the evidence cannot tell it apart from a wrong mapping. */
  vacuous: boolean;
}

export interface InferredRuleEvidence {
  app: string;
  id: string;
  statement: string;
  status: GenerationStatus;
  adoption: AutoTier;
  files: number;
  following: number;
}

export interface GapEntry {
  status: GapStatus;
  source: (SentenceSource & { line?: number }) | null;
  template?: string;
  /** The rule id a declared sentence would be adopted under (`archprint/<id>` in ESLint). */
  id?: string;
  /** The mapping restated in plain words, to compare with the quote. */
  mapped?: string;
  evidence?: GapEvidence;
  breaking?: DeclaredViolation[];
  rule?: InferredRuleEvidence;
  reason?: string;
}

export interface GapReport {
  entries: GapEntry[];
}

const joined = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;

const packagePhrase = (target: PackageTarget): string =>
  target.imports === undefined
    ? `the package ${target.name}`
    : `${joined(target.imports)} from ${target.name}`;

/** A declared rule restated from its template, in the words the report and the rule card use. */
export function restate(rule: DeclaredRule): string {
  const except = rule.except.length > 0 ? ` (except ${joined(rule.except)})` : '';
  const scope = `files matching ${joined(rule.files)}${except}`;
  switch (rule.template) {
    case 'forbid-import':
      return `${scope} must not import ${joined([...rule.targets, ...rule.packages.map(packagePhrase)])}`;
    case 'forbid-usage':
      return `${scope} must not use the global ${joined(rule.usage)}`;
    case 'forbid-file':
      return `no new file may match ${joined(rule.files)}${except}`;
  }
}

function declaredEntry(
  rule: DeclaredRule,
  measure: DeclaredMeasure,
): Pick<GapEntry, 'status' | 'evidence' | 'breaking' | 'reason'> {
  const files = measure.scope.length;
  if (rule.template === 'forbid-file') {
    return {
      status: 'enforce-now',
      evidence: { files, following: files, elsewhere: 0, vacuous: files === 0 },
    };
  }
  const evidence: GapEvidence = {
    files,
    following: files - new Set(measure.violations.map((v) => v.file)).size,
    elsewhere: measure.elsewhere.length,
    vacuous: measure.violations.length === 0 && measure.elsewhere.length === 0,
  };
  if (measure.scope.length === 0) {
    return { status: 'no-match', evidence, reason: `no source file matches ${joined(rule.files)}` };
  }
  if (measure.unmatchedTargets.length > 0) {
    return {
      status: 'no-match',
      evidence,
      reason: `no source file matches ${joined(measure.unmatchedTargets)}`,
    };
  }
  return measure.violations.length > 0
    ? { status: 'baseline', evidence, breaking: measure.violations }
    : { status: 'enforce-now', evidence };
}

function inferredEntry(
  sentence: InferredSentence,
  scans: () => { app: string; rules: RuleSummary[] }[],
): Pick<GapEntry, 'status' | 'rule' | 'reason'> {
  for (const { app, rules } of scans()) {
    const rule = findRule(sentence.rule, rules);
    if (rule !== undefined) {
      return {
        status: 'inferred',
        rule: {
          app,
          id: rule.id,
          statement: rule.statement,
          status: rule.status,
          adoption: rule.adoption,
          files: rule.observations,
          following: rule.observations - rule.violatingFiles,
        },
      };
    }
  }
  return {
    status: 'no-match',
    reason: `archprint finds no rule "${sentence.rule}" here; archprint scan lists the ones it finds`,
  };
}

function appDirsUnder(root: string): string[] {
  const dirs = discoverAppDirs(root);
  if (dirs.length === 0) {
    throw new Error(
      `No tsconfig.json found under ${root}. Pass the repository root, where the context files are (a directory with a tsconfig.json, or a monorepo root).`,
    );
  }
  return dirs;
}

/**
 * Verifies each sentence of an agent's mapping against the repository at `root` (globs and source files are
 * relative to it): that the quote is in the file, that the mapping matches code, and what follows or breaks it.
 */
export function buildGapReport(root: string, mapping: unknown): GapReport {
  const absoluteRoot = path.resolve(root);
  const parsed: MappingEntry[] = parseMapping(mapping);
  const apps = appDirsUnder(absoluteRoot);

  const declared = parsed.flatMap((entry) =>
    'sentence' in entry && isDeclaredRule(entry.sentence) ? [entry.sentence] : [],
  );
  const measures = new Map<DeclaredRule, DeclaredMeasure>();
  if (declared.length > 0) {
    const results = measureDeclared(loadCodebase(absoluteRoot), declared);
    declared.forEach((rule, index) => measures.set(rule, results[index]!));
  }

  let summaries: { app: string; rules: RuleSummary[] }[] | undefined;
  const scans = (): { app: string; rules: RuleSummary[] }[] =>
    (summaries ??= apps.map((dir) => ({
      app: path.relative(absoluteRoot, dir) || '.',
      rules: summarizeRules(scanRepo(dir, { deep: false }), Number.POSITIVE_INFINITY),
    })));

  const entries = parsed.map((entry): GapEntry => {
    if ('invalid' in entry)
      return { status: 'invalid', source: entry.source, reason: entry.invalid };
    const { sentence } = entry;
    const named = isDeclaredRule(sentence)
      ? { id: declaredRuleId(sentence.name), mapped: restate(sentence) }
      : {};
    const located = locateQuote(absoluteRoot, sentence.source.file, sentence.source.quote);
    if ('missing' in located) {
      return {
        status: 'quote-not-found',
        source: sentence.source,
        template: sentence.template,
        ...named,
        reason: located.missing,
      };
    }
    const base = {
      source: { ...sentence.source, line: located.line },
      template: sentence.template,
      ...named,
    };
    if (sentence.template === 'none')
      return { ...base, status: 'guidance', reason: sentence.reason };
    if (sentence.template === 'inferred') return { ...base, ...inferredEntry(sentence, scans) };
    return { ...base, ...declaredEntry(sentence, measures.get(sentence)!) };
  });
  return { entries };
}

const GROUPS: readonly { title: string; statuses: readonly GapStatus[] }[] = [
  { title: 'Enforce now', statuses: ['enforce-now'] },
  { title: 'Enforce with a baseline (broken today)', statuses: ['baseline'] },
  { title: 'Already an archprint rule', statuses: ['inferred'] },
  { title: 'Check the mapping', statuses: ['no-match', 'quote-not-found', 'invalid'] },
  { title: 'Guidance only', statuses: ['guidance'] },
];

const LISTED_BREAKS = 10;

const STATUS_NOTES: Partial<Record<GapStatus, string>> = {
  'no-match': 'Matches nothing',
  'quote-not-found': 'Quote not found',
  invalid: 'Not a valid mapping',
};

function evidenceLines(entry: GapEntry): string[] {
  const { evidence } = entry;
  if (evidence === undefined) return [];
  if (entry.template === 'forbid-file') {
    return [
      evidence.files === 0
        ? 'No file matches it today, so nothing is frozen yet: check the glob.'
        : `Freezes the ${evidence.files} file(s) there today. Not verified: whether any were added after the sentence was written.`,
    ];
  }
  if (entry.status === 'no-match') return [];
  const lines = [`${evidence.following} of ${evidence.files} file(s) follow it.`];
  if (evidence.vacuous) {
    lines.push(
      'Nothing in the code does this, in scope or out: check the mapping names the right thing.',
    );
  } else if (evidence.elsewhere > 0) {
    lines.push(`${evidence.elsewhere} file(s) outside the scope do it.`);
  }
  const breaking = entry.breaking ?? [];
  for (const violation of breaking.slice(0, LISTED_BREAKS)) {
    lines.push(`  ${violation.file}:${violation.line}  ${violation.subject}`);
  }
  if (breaking.length > LISTED_BREAKS)
    lines.push(`  ... and ${breaking.length - LISTED_BREAKS} more`);
  return lines;
}

function entryLines(entry: GapEntry): string[] {
  const where = entry.source
    ? `${entry.source.file}${entry.source.line === undefined ? '' : `:${entry.source.line}`}`
    : 'no source';
  const label =
    entry.id ?? entry.rule?.id ?? (entry.status === 'guidance' ? 'guidance' : entry.template);
  const lines = [`${label ?? 'entry'}  (${where})`];
  if (entry.source) lines.push(`  "${entry.source.quote}"`);
  if (entry.mapped) lines.push(`  Mapped as: ${entry.mapped}.`);
  if (entry.rule) {
    const { rule } = entry;
    lines.push(
      `  archprint rule ${rule.id} (${rule.status}, ${rule.adoption}${rule.app === '.' ? '' : `, ${rule.app}`}): ${rule.statement}.`,
      `  ${rule.following} of ${rule.files} file(s) follow it.`,
    );
  }
  const note = STATUS_NOTES[entry.status];
  if (note !== undefined || entry.status === 'guidance') {
    lines.push(`  ${note ?? 'Not checkable by a template'}: ${entry.reason}.`);
  }
  return [...lines, ...evidenceLines(entry).map((line) => `  ${line}`)];
}

export function renderGapReport(report: GapReport): string {
  const count = (statuses: readonly GapStatus[]): number =>
    report.entries.filter((entry) => statuses.includes(entry.status)).length;
  const lines = [
    `Gap report: ${report.entries.length} sentence(s) mapped. ${GROUPS.map(
      (group) => `${group.title}: ${count(group.statuses)}`,
    ).join('. ')}.`,
  ];
  for (const group of GROUPS) {
    const entries = report.entries.filter((entry) => group.statuses.includes(entry.status));
    if (entries.length === 0) continue;
    lines.push('', `${group.title} (${entries.length})`);
    for (const entry of entries) lines.push(...entryLines(entry).map((line) => `  ${line}`));
  }
  return lines.join('\n');
}
