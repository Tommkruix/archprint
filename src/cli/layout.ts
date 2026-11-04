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
  LEGACY_RULES_FILE,
  readAdoptedRules,
  type ResolutionMode,
} from './adopted-rules.js';
import {
  allowedFilesByRule,
  LEGACY_ALLOW_FILE,
  readAllowed,
  sortAllowed,
} from './allowed-exceptions.js';

export interface WriteLayoutOptions {
  structural?: boolean;
  enforcers: InstalledEnforcers;
  only?: string;
  ruleIds?: readonly string[];
  /** Start from the default rule set instead of keeping the rules adopted before. */
  reset?: boolean;
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
  removed: string[];
  folded: string[];
  readme: 'created' | 'updated' | 'skipped' | 'off';
  configPath: string;
  /** Previously adopted rules outside this run's selection that it kept, and those the current scan no longer generates. */
  kept: string[];
  dropped: string[];
  /** Previously adopted rules --reset removed. */
  reset: string[];
  /** Every file this run wrote or changed, relative to the working directory. */
  touched: string[];
  /** Recorded exceptions the code no longer has, so the rules now apply to them. */
  fixed: RuleExceptions[];
  /** Exceptions recorded for the first time, for rules an earlier version adopted without them. */
  firstRecorded: RuleExceptions[];
  /** Forbidden-import exceptions measured again because this run's resolution mode differs from the rule's. */
  remeasured: RuleExceptions[];
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
  const allowed = readAllowed(outDir);
  const collectOptions: CollectOptions = {
    allowed: allowedFilesByRule(allowed),
    appPath: options.app,
    structural: options.structural,
    enforcers: options.enforcers,
    only: options.only,
    ruleIds: options.ruleIds,
    mode: options.mode,
  };
  const requested = collectEnforcement(scan, collectOptions);
  if (requested.unknownRules.length > 0)
    throw new UnknownRulesError(
      requested.unknownRules,
      requested.availableRules,
      options.structural ?? false,
    );
  const adoptedBefore = readAdoptedRules(outDir) ?? [];
  const previousRules = options.reset ? [] : adoptedBefore;
  const exceptionsNow = currentExceptions(scan);
  const comparable = previousRules.filter(comparableIn(options.mode));
  const broken = newExceptions(comparable, exceptionsNow);
  if (broken.length > 0) throw new NewViolationsError(broken);
  const previous = adoptedBefore.map((rule) => rule.id);
  const carried = options.reset ? [] : carriedRuleIds(previous, requested.adopted);
  const removed = cleanPrior(outDir, options.cwd);
  const emitted = emitLayout(scan, outDir, {
    ...withCarried(collectOptions, requested.adopted, carried),
    expand: options.expand,
    graph: options.only === undefined && options.graph !== false,
    version: options.version,
  });
  const emittedIds = new Set(emitted.rules.map((rule) => rule.id));
  const keptRules = previousRules.filter((rule) => emittedIds.has(rule.id));
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
      renderAdoptionBody(adoption, emitted.rules),
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
        rules: emitted.rules.map((rule) => ({
          ...rule,
          exceptions: exceptionsNow.get(rule.id) ?? [],
        })),
        allowed: sortAllowed(allowed),
      },
      managed,
    ),
  );
  const folded = removeFoldedFiles(outDir, options.cwd);
  return {
    files,
    removed,
    folded,
    readme,
    configPath,
    kept: carried.filter((id) => emittedIds.has(id)),
    dropped: carried.filter((id) => !emittedIds.has(id)),
    reset: options.reset ? previous.filter((id) => !emittedIds.has(id)) : [],
    fixed: fixedExceptions(keptComparable, exceptionsNow),
    firstRecorded: firstRecorded(keptRules, exceptionsNow),
    remeasured: remeasured(keptRules, exceptionsNow, options.mode),
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
