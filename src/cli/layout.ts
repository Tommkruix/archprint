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
  /** Previously adopted rules a scoped run kept, and those the current scan no longer generates. */
  kept: string[];
  dropped: string[];
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

/** The rules a scoped run (--only, --rules) keeps from the previous adoption: it adds to them, never replaces them. */
function carriedRuleIds(
  outDir: string,
  options: CollectOptions,
  requested: readonly AdoptedRule[],
): string[] {
  if (options.only === undefined && options.ruleIds === undefined) return [];
  const requestedIds = new Set(requested.map((rule) => rule.id));
  return (readAdoptedRules(outDir) ?? [])
    .map((rule) => rule.id)
    .filter((id) => !requestedIds.has(id));
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
  const carried = carriedRuleIds(outDir, collectOptions, requested.adopted);
  const removed = cleanPrior(outDir, options.cwd);
  const emitted = emitLayout(scan, outDir, {
    ...withCarried(collectOptions, requested.adopted, carried),
    expand: options.expand,
    graph: options.only === undefined && options.graph !== false,
    version: options.version,
  });
  const emittedIds = new Set(emitted.rules.map((rule) => rule.id));
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
      renderAdoptionBody(adoption),
    );
    readme = result.status;
    if (result.status === 'created') readmeCreated = true;
  }

  const outRel = path.relative(options.cwd, outDir) || ARCHPRINT_DIR;
  const ignoreEntry = `${outRel.split(path.sep).join('/')}/`;
  let prettierignore = prior?.managed.prettierignore ?? false;
  let prettierignoreCreated = prior?.managed.prettierignoreCreated ?? false;
  let npmignore = prior?.managed.npmignore ?? false;
  const npmignoreCreated = prior?.managed.npmignoreCreated ?? false;
  if (files.length > 0) {
    const prettier = ensureIgnoreEntry(path.join(options.cwd, '.prettierignore'), ignoreEntry);
    if (prettier !== 'skipped') prettierignore = true;
    if (prettier === 'created') prettierignoreCreated = true;
    const npm = ensureIgnoreEntry(path.join(options.cwd, '.npmignore'), ignoreEntry, {
      create: false,
    });
    if (npm !== 'skipped') npmignore = true;
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
      { rules: emitted.rules, allowed: sortAllowed(allowed) },
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
  };
}
