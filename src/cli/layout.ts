import { existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { assertRealDirectory, ownedPath, removeOwnedFile } from '../generator/owned-paths.js';
import type { InstalledEnforcers } from '../scanner/enforcers.js';
import { ARCHPRINT_DIR, collectEnforcement, type CollectOptions, emitLayout } from './generate.js';
import { buildConfig, readConfig, writeConfig, type ManagedOutputs } from './archprint-config.js';
import { injectAdoptionSection } from './adoption-readme.js';
import { ensureIgnoreEntry } from './ignore-file.js';
import { reconcileWithAdopted, type Recommendations } from './recommend.js';
import { renderAdoptionBody } from './report.js';
import type { ScanResult } from './scan.js';
import { currentExceptions } from './summary.js';
import { baselineRuleIds, promoteBelowGate } from './promote.js';
import {
  comparableIn,
  firstRecorded,
  fixedExceptions,
  newExceptions,
  NewViolationsError,
  remeasured,
  type RuleExceptions,
} from './ratchet.js';
import {
  type AdoptedRule,
  byRuleId,
  type DeclaredAdoptedRule,
  LEGACY_RULES_FILE,
  readAdoptedRules,
  readRemovedRules,
  readStated,
  type ResolutionMode,
  type StatedSentence,
} from './adopted-rules.js';
import { findRule } from './rule-ref.js';
import { measureAdopted } from './check-evaluate.js';
import {
  breakingFiles,
  type DeclaredResult,
  declareFromMapping,
  relocateSources,
  remeasure,
} from './declared-adoption.js';
import {
  allowedFilesByRule,
  LEGACY_ALLOW_FILE,
  readAllowed,
  sortAllowed,
} from './allowed-exceptions.js';

const isDeclared = (rule: AdoptedRule): rule is DeclaredAdoptedRule => rule.family === 'declared';

export interface WriteLayoutOptions {
  structural?: boolean;
  enforcers: InstalledEnforcers;
  only?: string;
  ruleIds?: readonly string[];
  /** Start from the default rule set instead of keeping the rules adopted before. */
  reset?: boolean;
  /** Adopted rules to remove, by id, label or ESLint name; later runs leave them out until adopted again. */
  remove?: readonly string[];
  /** Adopt the rules named in `ruleIds` below the confidence gate, recording their current breaks as exceptions. */
  baseline?: boolean;
  /** A gap-report mapping whose verified sentences this run adopts as declared rules (broken ones with `baseline`). */
  declare?: unknown;
  expand?: boolean;
  graph?: boolean;
  mode: ResolutionMode;
  version: string;
  recommendations: Recommendations;
  app: string;
  cwd: string;
  readme?: boolean;
}

export interface WriteLayoutResult {
  files: string[];
  /** Outputs an earlier run wrote that this run no longer writes, so they were deleted. */
  removed: string[];
  folded: string[];
  readme: 'created' | 'updated' | 'skipped' | 'off';
  configPath: string;
  /** Rules this run adopted that were not adopted before it, a removed rule adopted again included. */
  adopted: string[];
  /** Previously adopted rules this run kept, and those outside its selection the current scan no longer generates. */
  kept: string[];
  dropped: string[];
  /** Previously adopted rules --reset removed. */
  reset: string[];
  /** The adopted rules --remove removed. */
  removedRules: string[];
  /** Every file this run wrote or changed, relative to the working directory. */
  touched: string[];
  /** Recorded exceptions the code no longer has, so the rules now apply to them. */
  fixed: RuleExceptions[];
  /** Exceptions recorded for the first time, for rules an earlier version adopted without them. */
  firstRecorded: RuleExceptions[];
  /** Forbidden-import exceptions measured again because this run's resolution mode differs from the rule's. */
  remeasured: RuleExceptions[];
  /** Rules named with --baseline, with the exceptions this run recorded for them. */
  baselined: RuleExceptions[];
  declared: DeclaredResult;
}

export class UnknownRulesError extends Error {
  constructor(unknown: readonly string[], available: readonly string[], structural: boolean) {
    super(
      `--rules names no rule this run would generate: ${unknown.join(', ')}. ` +
        (available.length > 0
          ? `Rules available: ${available.join(', ')}.`
          : 'This run generates no rules.') +
        (structural
          ? ''
          : ' Structural rules, such as layer boundaries, need --include-structural.'),
    );
  }
}

export class UnknownRemovalError extends Error {
  constructor(unknown: readonly string[], adopted: readonly string[]) {
    super(
      `--remove names no adopted rule: ${unknown.join(', ')}. ` +
        (adopted.length > 0 ? `Adopted rules: ${adopted.join(', ')}.` : 'No rule is adopted.'),
    );
  }
}

export class RemovalConflictError extends Error {
  constructor(flag: '--rules' | '--declare', ids: readonly string[]) {
    super(`--remove and ${flag} both name ${ids.join(', ')}; keep it in one of them.`);
  }
}

/** The adopted rules the --remove references name, in adoption order. */
function rulesToRemove(refs: readonly string[], adopted: readonly AdoptedRule[]): AdoptedRule[] {
  const unknown = refs.filter((ref) => findRule(ref, adopted) === undefined);
  if (unknown.length > 0)
    throw new UnknownRemovalError(
      unknown.map((ref) => ref.trim()),
      adopted.map((rule) => rule.id),
    );
  return adopted.filter((rule) => refs.some((ref) => findRule(ref, [rule]) !== undefined));
}

const statedKey = (entry: StatedSentence): string =>
  [entry.rule, entry.file, entry.quote].join('\u0000');

/** Each stated sentence once, by rule, file and quote. */
function uniqueStated(entries: readonly StatedSentence[]): StatedSentence[] {
  const byKey = new Map(entries.map((entry) => [statedKey(entry), entry]));
  return [...byKey.keys()].sort().map((key) => byKey.get(key)!);
}

const LEGACY_FILES: readonly string[] = [LEGACY_RULES_FILE, LEGACY_ALLOW_FILE];

function cleanPrior(outDir: string, cwd: string): string[] {
  const prior = readConfig(outDir);
  if (!prior) return [];
  const removed: string[] = [];
  for (const relative of prior.managed.files) {
    const target = ownedPath(outDir, path.resolve(cwd, relative));
    if (target !== null && existsSync(target) && !LEGACY_FILES.includes(path.basename(target))) {
      rmSync(target, { recursive: true, force: true });
      removed.push(relative);
    }
  }
  return removed;
}

/** Deletes the files whose content config.json now holds. */
function removeFoldedFiles(outDir: string, cwd: string): string[] {
  const folded: string[] = [];
  for (const name of LEGACY_FILES) {
    const target = path.join(outDir, name);
    if (removeOwnedFile(outDir, target)) folded.push(path.relative(cwd, target));
  }
  return folded;
}

/** The previously adopted rules outside this run's selection: a run adds to the adoption, never replaces it. */
function carriedRuleIds(previous: readonly string[], requested: readonly AdoptedRule[]): string[] {
  const requestedIds = new Set(requested.map((rule) => rule.id));
  return previous.filter((id) => !requestedIds.has(id));
}

/** Selects the requested and carried rules by id, across every family: a carried rule was adopted, held or not. */
function withCarried(
  options: CollectOptions,
  requested: readonly AdoptedRule[],
  carried: readonly string[],
): CollectOptions {
  if (carried.length === 0) return options;
  return {
    ...options,
    structural: true,
    only: undefined,
    ruleIds: [...requested.map((rule) => rule.id), ...carried],
  };
}

export function writeLayout(
  scan: ScanResult,
  outDir: string,
  options: WriteLayoutOptions,
): WriteLayoutResult {
  assertRealDirectory(outDir);
  const adoptedBefore = readAdoptedRules(outDir) ?? [];
  const removing = rulesToRemove(options.remove ?? [], adoptedBefore);
  const reAdopted = (options.ruleIds ?? []).filter((ref) => findRule(ref, removing) !== undefined);
  if (reAdopted.length > 0) throw new RemovalConflictError('--rules', reAdopted);
  const removingIds = new Set(removing.map((rule) => rule.id));
  const remaining = adoptedBefore.filter((rule) => !removingIds.has(rule.id));
  const inferredBefore = remaining.filter((rule) => !isDeclared(rule));
  const declaredBefore = options.reset ? [] : remaining.filter(isDeclared);
  const excluded = [
    ...(options.reset ? [] : readRemovedRules(outDir)),
    ...removing.filter((rule) => !isDeclared(rule)).map((rule) => rule.id),
  ];
  const baselineIds =
    options.baseline && options.ruleIds !== undefined ? baselineRuleIds(scan, options.ruleIds) : [];
  const enforced = promoteBelowGate(
    scan,
    new Set([...baselineIds, ...(options.reset ? [] : inferredBefore.map((rule) => rule.id))]),
  );
  const allowed = readAllowed(outDir);
  const collectOptions: CollectOptions = {
    allowed: allowedFilesByRule(allowed),
    appPath: options.app,
    structural: options.structural,
    enforcers: options.enforcers,
    only: options.only,
    ruleIds: options.ruleIds,
    removed: excluded,
    mode: options.mode,
  };
  const requested = collectEnforcement(enforced, collectOptions);
  if (requested.unknownRules.length > 0)
    throw new UnknownRulesError(
      requested.unknownRules,
      requested.availableRules,
      options.structural ?? false,
    );
  const previousRules = options.reset ? [] : inferredBefore;
  const exceptionsNow = currentExceptions(scan);
  const comparable = previousRules
    .filter(comparableIn(options.mode))
    .filter((rule) => !baselineIds.includes(rule.id));
  const allowedFor = (ruleId: string): readonly string[] =>
    collectOptions.allowed?.get(ruleId) ?? [];
  const declaration =
    options.declare === undefined
      ? null
      : declareFromMapping(options.declare, {
          root: options.cwd,
          appDir: scan.appDir,
          rulesDir: outDir,
          baseline: options.baseline ?? false,
          allowedFor,
          adoptedRules: new Set([...inferredBefore, ...requested.adopted].map((rule) => rule.id)),
        });
  const redeclared = new Set(declaration?.adopted.map((rule) => rule.id));
  const declaredRemoving = [...redeclared].filter((id) => removingIds.has(id));
  if (declaredRemoving.length > 0) throw new RemovalConflictError('--declare', declaredRemoving);
  const declaredKept = declaredBefore.filter((rule) => !redeclared.has(rule.id));
  const keptMeasures = measureAdopted(scan.appDir, declaredKept, outDir);
  const declaredNow = new Map(
    declaredKept.map((rule) => [
      rule.id,
      breakingFiles(keptMeasures.get(rule.id)!, allowedFor(rule.id)),
    ]),
  );
  const broken = [
    ...newExceptions(comparable, exceptionsNow),
    ...newExceptions(declaredKept, declaredNow),
  ];
  if (broken.length > 0) throw new NewViolationsError(broken);
  const relocated = relocateSources(
    declaredKept.map((rule) => remeasure(rule, keptMeasures.get(rule.id)!, allowedFor(rule.id))),
    outDir,
  );
  const declaredRules = [...relocated.rules, ...(declaration?.adopted ?? [])].sort(byRuleId);
  const previous = inferredBefore.map((rule) => rule.id);
  const carried = options.reset ? [] : carriedRuleIds(previous, requested.adopted);
  const removed = cleanPrior(outDir, options.cwd);
  const emitted = emitLayout(enforced, outDir, {
    ...withCarried(collectOptions, requested.adopted, carried),
    expand: options.expand,
    graph: options.only === undefined && options.graph !== false,
    version: options.version,
    declared: declaredRules,
  });
  const emittedIds = new Set(emitted.rules.map((rule) => rule.id));
  const keptRules = previousRules.filter((rule) => emittedIds.has(rule.id));
  const stated = uniqueStated([
    ...(options.reset ? [] : readStated(outDir)),
    ...(declaration?.stated ?? []),
  ]).filter((entry) => emittedIds.has(entry.rule));
  const keptComparable = keptRules.filter(comparableIn(options.mode));
  const adoption = reconcileWithAdopted(options.recommendations, emitted.rules);
  const files = [emitted.eslint, emitted.depcruise, ...emitted.expanded].filter(
    (file): file is string => file !== null,
  );
  const prior = readConfig(outDir);

  let readme: WriteLayoutResult['readme'] = 'off';
  let readmeCreated = prior?.managed.readmeCreated ?? false;
  if (options.readme && files.length > 0) {
    const result = injectAdoptionSection(
      path.join(options.cwd, 'README.md'),
      renderAdoptionBody(adoption, [...emitted.rules, ...declaredRules]),
    );
    readme = result.status;
    if (result.status === 'created') readmeCreated = true;
  }

  const outRel = path.relative(options.cwd, outDir) || ARCHPRINT_DIR;
  const ignoreEntry = `${outRel.split(path.sep).join('/')}/`;
  const changedIgnoreFiles: string[] = [];
  let prettierignore = prior?.managed.prettierignore ?? false;
  let prettierignoreCreated = prior?.managed.prettierignoreCreated ?? false;
  let npmignore = prior?.managed.npmignore ?? false;
  const npmignoreCreated = prior?.managed.npmignoreCreated ?? false;
  if (files.length > 0) {
    const prettierPath = path.join(options.cwd, '.prettierignore');
    const prettier = ensureIgnoreEntry(prettierPath, ignoreEntry);
    if (prettier !== 'skipped') prettierignore = true;
    if (prettier === 'created') prettierignoreCreated = true;
    const npmPath = path.join(options.cwd, '.npmignore');
    const npm = ensureIgnoreEntry(npmPath, ignoreEntry, { create: false });
    if (npm !== 'skipped') npmignore = true;
    for (const [file, result] of [
      [prettierPath, prettier],
      [npmPath, npm],
    ] as const) {
      if (result === 'created' || result === 'appended') changedIgnoreFiles.push(file);
    }
  }

  const managed: ManagedOutputs = {
    files: files.map((file) => path.relative(options.cwd, file)),
    readme: readme !== 'off' && readme !== 'skipped' ? true : (prior?.managed.readme ?? false),
    readmeCreated,
    prettierignore,
    prettierignoreCreated,
    npmignore,
    npmignoreCreated,
  };
  const configPath = writeConfig(
    outDir,
    buildConfig(
      adoption,
      options.version,
      {
        app: options.app,
        rulesDir: path.relative(options.cwd, outDir) || ARCHPRINT_DIR,
      },
      {
        rules: [
          ...emitted.rules.map((rule) => ({
            ...rule,
            exceptions: exceptionsNow.get(rule.id) ?? [],
          })),
          ...declaredRules,
        ].sort(byRuleId),
        stated,
        removed: [...new Set(excluded)].filter((id) => !emittedIds.has(id)).sort(),
        allowed: sortAllowed(allowed),
      },
      managed,
    ),
  );
  const folded = removeFoldedFiles(outDir, options.cwd);
  return {
    files,
    removed: removed.filter((relative) => !managed.files.includes(relative)),
    folded,
    readme,
    configPath,
    adopted: emitted.rules
      .filter((rule) => !previous.includes(rule.id))
      .sort(byRuleId)
      .map((rule) => rule.id),
    kept: [...keptRules, ...declaredKept].sort(byRuleId).map((rule) => rule.id),
    dropped: carried.filter((id) => !emittedIds.has(id)),
    reset: options.reset
      ? [
          ...previous.filter((id) => !emittedIds.has(id)),
          ...adoptedBefore.filter(isDeclared).map((rule) => rule.id),
        ]
      : [],
    removedRules: removing.map((rule) => rule.id),
    fixed: [
      ...fixedExceptions(keptComparable, exceptionsNow),
      ...fixedExceptions(declaredKept, declaredNow),
    ],
    firstRecorded: firstRecorded(keptRules, exceptionsNow),
    remeasured: remeasured(keptRules, exceptionsNow, options.mode),
    baselined: baselineIds
      .filter((id) => emittedIds.has(id) && (exceptionsNow.get(id)?.length ?? 0) > 0)
      .map((id) => ({ rule: id, exceptions: [...exceptionsNow.get(id)!] })),
    declared: {
      adopted: declaration?.adopted ?? [],
      refused: declaration?.refused ?? [],
      kept: declaredKept.map((rule) => rule.id),
      replaced: declaredBefore.filter((rule) => redeclared.has(rule.id)).map((rule) => rule.id),
      stale: relocated.stale,
      stated: (declaration?.stated ?? []).filter((entry) => emittedIds.has(entry.rule)),
    },
    touched: [
      configPath,
      ...files,
      ...(readme === 'created' || readme === 'updated'
        ? [path.join(options.cwd, 'README.md')]
        : []),
      ...changedIgnoreFiles,
    ].map((file) => path.relative(options.cwd, file)),
  };
}
