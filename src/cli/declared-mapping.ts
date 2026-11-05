import type { DeclaredDefinition, PackageTarget } from '../detector/declared-rules.js';

/** Where a mapped sentence comes from: a file in the repo (CLAUDE.md, AGENTS.md, ...) and its words, quoted. */
export interface SentenceSource {
  file: string;
  quote: string;
}

/** A rule a team stated: a template the evaluator measures, named, with the sentence it comes from. */
export type DeclaredRule = DeclaredDefinition & { name: string; source: SentenceSource };

export interface InferredSentence {
  template: 'inferred';
  source: SentenceSource;
  rule: string;
}

export interface GuidanceSentence {
  template: 'none';
  source: SentenceSource;
  reason: string;
}

export type MappedSentence = DeclaredRule | InferredSentence | GuidanceSentence;

export type MappingEntry =
  { sentence: MappedSentence } | { invalid: string; source: SentenceSource | null };

export const DECLARED_TEMPLATES = ['forbid-import', 'forbid-usage', 'forbid-file'] as const;
type DeclaredTemplate = (typeof DECLARED_TEMPLATES)[number];
const TEMPLATES: readonly string[] = [...DECLARED_TEMPLATES, 'inferred', 'none'];

const isDeclaredTemplate = (template: string): template is DeclaredTemplate =>
  (DECLARED_TEMPLATES as readonly string[]).includes(template);

/** A team's rule is `doc-<name>`, a namespace no inferred rule uses. */
export const declaredRuleId = (name: string): string => `doc-${name}`;

export const isDeclaredRule = (sentence: MappedSentence): sentence is DeclaredRule =>
  isDeclaredTemplate(sentence.template);

export class MappingError extends Error {}

const MAX_SENTENCES = 200;
const MAX_LIST_LENGTH = 20;
const MAX_TEXT_LENGTH = 200;
const MAX_QUOTE_LENGTH = 500;
const MIN_QUOTE_LENGTH = 10;
const NAME = /^[a-z][a-z0-9-]{0,59}$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const USAGE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/;

const FIELDS: Record<string, readonly string[]> = {
  'forbid-import': ['files', 'except', 'targets', 'packages'],
  'forbid-usage': ['files', 'except', 'usage'],
  'forbid-file': ['files', 'except'],
  inferred: ['rule'],
  none: ['reason'],
};

class EntryError extends Error {}

const fail = (reason: string): never => {
  throw new EntryError(reason);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown, field: string, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || value.trim() === '') return fail(`"${field}" must be text`);
  if (value.length > max) return fail(`"${field}" is longer than ${max} characters`);
  return value;
}

function textList(value: unknown, field: string, required: boolean): string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0)) {
    return fail(`"${field}" must be a list${required ? ' with at least one item' : ''}`);
  }
  if (value.length > MAX_LIST_LENGTH)
    return fail(`"${field}" has more than ${MAX_LIST_LENGTH} items`);
  return value.map((item, index) => text(item, `${field}[${index}]`));
}

/** A repo-relative glob: no absolute path, no `..` segment, forward slashes. */
function globList(value: unknown, field: string, required: boolean): string[] {
  const globs = textList(value, field, required);
  for (const glob of globs) {
    if (glob.startsWith('/') || glob.includes('\\') || glob.split('/').includes('..')) {
      fail(
        `"${field}" holds "${glob}"; use a path relative to the repository, with forward slashes`,
      );
    }
    if (glob.startsWith('!') || glob.startsWith('#')) {
      fail(
        `"${field}" holds "${glob}"; list what to leave out in "except" instead of negating a glob`,
      );
    }
  }
  return globs;
}

function sourceOf(value: unknown): SentenceSource {
  if (!isRecord(value)) return fail('"source" must be { "file", "quote" }');
  const file = text(value.file, 'source.file');
  const quote = text(value.quote, 'source.quote', MAX_QUOTE_LENGTH);
  if (quote.replace(/\s+/g, ' ').trim().length < MIN_QUOTE_LENGTH) {
    fail(`"source.quote" must quote the sentence, at least ${MIN_QUOTE_LENGTH} characters`);
  }
  return { file, quote };
}

function packageTargets(value: unknown): PackageTarget[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail('"packages" must be a list of { "name", "imports"? }');
  if (value.length > MAX_LIST_LENGTH)
    return fail(`"packages" has more than ${MAX_LIST_LENGTH} items`);
  return value.map((item, index) => {
    if (!isRecord(item)) return fail(`"packages[${index}]" must be { "name", "imports"? }`);
    const name = text(item.name, `packages[${index}].name`);
    if (item.imports === undefined) return { name };
    const imports = textList(item.imports, `packages[${index}].imports`, true);
    const bad = imports.find((imported) => !IDENTIFIER.test(imported));
    if (bad !== undefined) fail(`"packages[${index}].imports" holds "${bad}", not an export name`);
    return { name, imports };
  });
}

function declaredRule(
  template: DeclaredTemplate,
  entry: Record<string, unknown>,
  source: SentenceSource,
): DeclaredRule {
  const name = text(entry.name, 'name');
  if (!NAME.test(name))
    fail(`"name" must be lowercase words joined by "-", e.g. no-fetch-in-components`);
  const scope = {
    name,
    source,
    files: globList(entry.files, 'files', true),
    except: globList(entry.except, 'except', false),
  };
  if (template === 'forbid-usage') {
    const usage = textList(entry.usage, 'usage', true);
    const bad = usage.find((item) => !USAGE.test(item));
    if (bad !== undefined)
      fail(`"usage" holds "${bad}"; name a global (fetch) or a global and member (process.env)`);
    return { template, ...scope, usage };
  }
  if (template === 'forbid-import') {
    const targets = globList(entry.targets, 'targets', false);
    const packages = packageTargets(entry.packages);
    if (targets.length === 0 && packages.length === 0)
      fail('"forbid-import" needs "targets" or "packages"');
    return { template, ...scope, targets, packages };
  }
  return { template, ...scope };
}

function sentenceOf(entry: unknown): MappedSentence {
  if (!isRecord(entry)) return fail('each item in "rules" must be an object');
  const template = entry.template;
  if (typeof template !== 'string' || !TEMPLATES.includes(template)) {
    return fail(`"template" must be one of ${TEMPLATES.join(', ')}`);
  }
  const source = sourceOf(entry.source);
  const named = isDeclaredTemplate(template) ? ['name'] : [];
  const allowed = new Set(['template', 'source', ...named, ...FIELDS[template]!]);
  const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
  if (unknown.length > 0)
    fail(`"${template}" takes no ${unknown.map((key) => `"${key}"`).join(', ')}`);
  if (isDeclaredTemplate(template)) return declaredRule(template, entry, source);
  if (template === 'inferred') return { template, source, rule: text(entry.rule, 'rule') };
  return { template: 'none', source, reason: text(entry.reason, 'reason') };
}

const sourceIfValid = (entry: unknown): SentenceSource | null => {
  try {
    return isRecord(entry) ? sourceOf(entry.source) : null;
  } catch {
    return null;
  }
};

/** A mapping file's text as JSON; a parse error names the problem. */
export function parseMappingJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new MappingError(`The mapping is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * The sentences of a mapping an agent wrote: `{ "rules": [...] }`, one entry per rule-like sentence. A malformed
 * entry is kept as invalid, with its reason, so the rest still get verified; a malformed mapping throws.
 */
export function parseMapping(input: unknown): MappingEntry[] {
  if (!isRecord(input) || !Array.isArray(input.rules)) {
    throw new MappingError('A mapping is { "rules": [ ... ] }, one entry per rule-like sentence.');
  }
  if (input.rules.length === 0) throw new MappingError('The mapping has no rules.');
  if (input.rules.length > MAX_SENTENCES) {
    throw new MappingError(`The mapping has more than ${MAX_SENTENCES} rules.`);
  }
  const names = new Set<string>();
  return input.rules.map((entry): MappingEntry => {
    try {
      const sentence = sentenceOf(entry);
      if (isDeclaredRule(sentence)) {
        if (names.has(sentence.name)) fail(`the name "${sentence.name}" is used twice`);
        names.add(sentence.name);
      }
      return { sentence };
    } catch (error) {
      /* v8 ignore next -- defensive: validation only throws EntryError */
      if (!(error instanceof EntryError)) throw error;
      return { invalid: error.message, source: sourceIfValid(entry) };
    }
  });
}
