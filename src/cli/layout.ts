import { existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { assertRealDirectory, ownedPath, removeOwnedFile } from '../generator/owned-paths.js';
import type { InstalledEnforcers } from '../scanner/enforcers.js';
import { ARCHPRINT_DIR, emitLayout } from './generate.js';
import { buildConfig, readConfig, writeConfig, type ManagedOutputs } from './archprint-config.js';
import { injectAdoptionSection } from './adoption-readme.js';
import { ensureIgnoreEntry } from './ignore-file.js';
import type { Recommendations } from './recommend.js';
import type { ScanResult } from './scan.js';
import { LEGACY_RULES_FILE, type ResolutionMode } from './adopted-rules.js';
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
  readmeBody?: string;
}

export interface WriteLayoutResult {
  files: string[];
  removed: string[];
  folded: string[];
  readme: 'created' | 'updated' | 'skipped' | 'off';
  configPath: string;
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

export function writeLayout(
  scan: ScanResult,
  outDir: string,
  options: WriteLayoutOptions,
): WriteLayoutResult {
  assertRealDirectory(outDir);
  const allowed = readAllowed(outDir);
  const removed = cleanPrior(outDir, options.cwd);
  const emitted = emitLayout(scan, outDir, {
    allowed: allowedFilesByRule(allowed),
    appPath: options.app,
    structural: options.structural,
    enforcers: options.enforcers,
    only: options.only,
    ruleIds: options.ruleIds,
    expand: options.expand,
    graph: options.graph,
    mode: options.mode,
    version: options.version,
  });
  const files = [emitted.eslint, emitted.depcruise, ...emitted.expanded].filter(
    (file): file is string => file !== null,
  );
  const prior = readConfig(outDir);

  let readme: WriteLayoutResult['readme'] = 'off';
  let readmeCreated = prior?.managed.readmeCreated ?? false;
  if (options.readmeBody !== undefined && files.length > 0) {
    const result = injectAdoptionSection(path.join(options.cwd, 'README.md'), options.readmeBody);
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
      options.recommendations,
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
  return { files, removed, folded, readme, configPath };
}
