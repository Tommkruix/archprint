import * as path from 'node:path';
import { wilsonLowerBound } from '../detector/confidence-gate.js';
import type { DeclaredMeasure } from '../detector/declared-rules.js';
import { measureAdopted } from './check-evaluate.js';
import {
  type AdoptionEvidence,
  type DeclaredAdoptedRule,
  declaredDefinition,
  readAdoptedRules,
} from './adopted-rules.js';
import { type DeclaredRule, declaredRuleId, isDeclaredRule } from './declared-mapping.js';
import { entryLabel, type GapEntry, restate, verifyMapping } from './gap-report.js';
import { findRule } from './rule-ref.js';
import { locateQuote } from './source-quote.js';

const toPosix = (value: string): string => value.split(path.sep).join('/');

/** The files that break a rule today, sorted, without the ones allowed with a reason. */
export const breakingFiles = (measure: DeclaredMeasure, allowed: readonly string[]): string[] =>
  [...new Set(measure.violations.map((violation) => violation.file))]
    .filter((file) => !allowed.includes(file))
    .sort();

/** A freeze is followed by every file there today; any other rule by the files that do not break it. */
function evidenceOf(rule: DeclaredAdoptedRule, measure: DeclaredMeasure): AdoptionEvidence {
  const total = measure.scope.length;
  const conforming =
    rule.template === 'forbid-file'
      ? total
      : total - new Set(measure.violations.map((violation) => violation.file)).size;
  return {
    conforming,
    total,
    floor: Math.round(wilsonLowerBound(conforming, total) * 10000) / 10000,
  };
}

/** A rule with this run's evidence and exceptions. */
export const remeasure = (
  rule: DeclaredAdoptedRule,
  measure: DeclaredMeasure,
  allowed: readonly string[],
): DeclaredAdoptedRule => ({
  ...rule,
  evidence: evidenceOf(rule, measure),
  exceptions: breakingFiles(measure, allowed),
});

function toAdopted(sentence: DeclaredRule, root: string, line: number): DeclaredAdoptedRule {
  return {
    id: declaredRuleId(sentence.name),
    family: 'declared',
    statement: sentence.source.quote,
    mode: 'fast',
    evidence: { conforming: 0, total: 0, floor: 0 },
    root,
    source: { file: sentence.source.file, line },
    ...declaredDefinition(sentence),
  };
}

export interface DeclarationRefusal {
  /** The rule id the sentence would get or maps to, `guidance`, or its template. */
  label: string;
  quote: string | null;
  reason: string;
}

export interface Declaration {
  /** The rules this mapping adopts in the app, measured, with what breaks them today as exceptions. */
  adopted: DeclaredAdoptedRule[];
  refused: DeclarationRefusal[];
}

export interface DeclareOptions {
  /** The directory the mapping's globs and source files are relative to, where the gap report ran. */
  root: string;
  appDir: string;
  rulesDir: string;
  /** Adopt sentences the code breaks today too, recording the breaks as exceptions. */
  baseline: boolean;
  allowedFor: (ruleId: string) => readonly string[];
}

/** Why a verified sentence is not adopted, or null when it is: the code follows it, or breaks it with `baseline`. */
function refusalOf(entry: GapEntry, baseline: boolean): string | null {
  switch (entry.status) {
    case 'enforce-now':
      return null;
    case 'baseline':
      return baseline
        ? null
        : 'the code breaks it today; adopt it with --baseline to record the breaks';
    case 'inferred':
      return `already an archprint rule: adopt it with --rules ${entry.rule!.id}`;
    case 'guidance':
      return `guidance only: ${entry.reason}`;
    default:
      return entry.reason!;
  }
}

/**
 * The sentences of a gap-report mapping this app adopts as declared rules, verified again first: those the code
 * follows, and those it breaks today with `baseline`. Every other sentence is refused with the reason.
 */
export function declareFromMapping(mapping: unknown, options: DeclareOptions): Declaration {
  const root = toPosix(path.relative(options.rulesDir, options.root)) || '.';
  const refused: DeclarationRefusal[] = [];
  const candidates: DeclaredAdoptedRule[] = [];
  for (const { entry, sentence } of verifyMapping(options.root, mapping)) {
    const reason = refusalOf(entry, options.baseline);
    if (reason === null && sentence !== null && isDeclaredRule(sentence)) {
      candidates.push(toAdopted(sentence, root, entry.source!.line!));
      continue;
    }
    refused.push({
      label: entryLabel(entry),
      quote: entry.source?.quote ?? null,
      reason: reason ?? entry.status,
    });
  }
  const measures = measureAdopted(options.appDir, candidates, options.rulesDir);
  const adopted: DeclaredAdoptedRule[] = [];
  for (const candidate of candidates) {
    const measure = measures.get(candidate.id)!;
    if (measure.scope.length === 0 && candidate.template !== 'forbid-file') {
      refused.push({
        label: candidate.id,
        quote: candidate.statement,
        reason: `no file of ${toPosix(path.relative(options.root, options.appDir)) || '.'} matches ${candidate.files.join(', ')}; adopt it from the app that holds them`,
      });
      continue;
    }
    adopted.push(remeasure(candidate, measure, options.allowedFor(candidate.id)));
  }
  return { adopted, refused };
}

/**
 * Each rule with its sentence's current line, and the rules whose sentence is no longer in its file: those keep
 * their last line and stay in force, since a rule is removed only on purpose.
 */
export function relocateSources(
  rules: readonly DeclaredAdoptedRule[],
  rulesDir: string,
): { rules: DeclaredAdoptedRule[]; stale: DeclaredAdoptedRule[] } {
  const stale: DeclaredAdoptedRule[] = [];
  const relocated = rules.map((rule) => {
    const found = locateQuote(path.resolve(rulesDir, rule.root), rule.source.file, rule.statement);
    if ('missing' in found) {
      stale.push(rule);
      return rule;
    }
    return { ...rule, source: { ...rule.source, line: found.line } };
  });
  return { rules: relocated, stale };
}

export interface DeclaredResult {
  /** Rules this run adopted from the mapping, with what breaks them today. */
  adopted: DeclaredAdoptedRule[];
  /** Sentences of the mapping this run did not adopt, with the reason. */
  refused: DeclarationRefusal[];
  /** Declared rules adopted before that this run kept. */
  kept: string[];
  /** Declared rules adopted before that the mapping defined again, replacing them. */
  replaced: string[];
  /** Kept rules whose sentence is no longer in its file. */
  stale: DeclaredAdoptedRule[];
}

function evidenceLine(rule: DeclaredAdoptedRule): string {
  const { conforming, total } = rule.evidence;
  if (rule.template === 'forbid-file') {
    return `freezes the ${total} file(s) there today; a new one breaks it`;
  }
  const breaks = rule.exceptions ?? [];
  const recorded =
    breaks.length === 0
      ? ''
      : `; ${breaks.length} recorded as exceptions, which generate only removes as they are fixed: ${breaks.join(', ')}`;
  return `${conforming} of ${total} file(s) follow it${recorded}`;
}

const adoptedLines = (rule: DeclaredAdoptedRule): string[] => [
  `  ${rule.id}  "${rule.statement}" (${rule.source.file}:${rule.source.line})`,
  `    ${evidenceLine(rule)}`,
];

/** What `generate --declare` adopted, refused and found stale, for the terminal. */
export function describeDeclared(result: DeclaredResult, hasEslint: boolean): string[] {
  const lines: string[] = [];
  if (result.adopted.length > 0) {
    lines.push(`Adopted ${result.adopted.length} rule(s) your context files state:`);
    for (const rule of result.adopted) lines.push(...adoptedLines(rule));
    if (result.replaced.length > 0) {
      lines.push(`Replaced the earlier definition of ${result.replaced.join(', ')}.`);
    }
    if (!hasEslint) {
      lines.push(
        'This repo has no ESLint config, so archprint check enforces these rules; dependency-cruiser does not enforce declared rules.',
      );
    }
  }
  if (result.refused.length > 0) {
    lines.push(`Not adopted (${result.refused.length}):`);
    for (const refusal of result.refused) {
      const quote = refusal.quote === null ? '' : ` "${refusal.quote}"`;
      lines.push(`  ${refusal.label}${quote}: ${refusal.reason}`);
    }
  }
  for (const rule of result.stale) {
    lines.push(
      `The sentence behind ${rule.id} is no longer in ${rule.source.file}; the rule stays in force. Restore the sentence, or remove the rule with archprint generate --reset.`,
    );
  }
  return lines;
}

/** Whether a rule reference names a declared rule: its id, or its ESLint name. */
export const isDeclaredRef = (ref: string): boolean => /^(?:archprint\/)?doc-/i.test(ref.trim());

/** The declared rule a reference names among those adopted in a rules directory. */
export function findDeclared(ref: string, rulesDir: string): DeclaredAdoptedRule | undefined {
  const declared = (readAdoptedRules(rulesDir) ?? []).filter(
    (rule): rule is DeclaredAdoptedRule => rule.family === 'declared',
  );
  return findRule(ref, declared);
}

/** A declared rule explained: the team's sentence, what it enforces, its evidence and its exceptions. */
export function renderDeclaredExplain(rule: DeclaredAdoptedRule): string {
  const exceptions = rule.exceptions ?? [];
  return [
    `${rule.id}  (stated in ${rule.source.file}:${rule.source.line})`,
    `  "${rule.statement}"`,
    `  Enforces: ${restate(rule)}.`,
    '  Your team stated this rule, so no confidence gate applies; archprint checks the code against it.',
    `  When last generated: ${evidenceLine(rule)}.`,
    ...(exceptions.length === 0 || rule.template === 'forbid-file'
      ? []
      : [`  Exceptions (${exceptions.length}): ${exceptions.join(', ')}`]),
    '  Enforced by the generated ESLint rule and archprint check; dependency-cruiser does not enforce declared rules.',
  ].join('\n');
}
