import { existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import type { InstalledEnforcers } from '../scanner/enforcers.js';
import { ARCHPRINT_DIR, emitLayout } from './generate.js';
import { buildConfig, readConfig, writeConfig, type ManagedOutputs } from './archprint-config.js';
import { injectAdoptionSection } from './adoption-readme.js';
import { ensureIgnoreEntry } from './ignore-file.js';
import type { Recommendations } from './recommend.js';
import type { ScanResult } from './scan.js';

export interface WriteLayoutOptions {
  structural?: boolean;
  enforcers: InstalledEnforcers;
  only?: string;
  ruleIds?: readonly string[];
  expand?: boolean;
  graph?: boolean;
  version: string;
  recommendations: Recommendations;
  app: string;
  cwd: string;
  readmeBody?: string;
}

export interface WriteLayoutResult {
  files: string[];
  removed: string[];
  readme: 'created' | 'updated' | 'skipped' | 'off';
  configPath: string;
}

function cleanPrior(outDir: string, cwd: string): string[] {
  const prior = readConfig(outDir);
  if (!prior) return [];
  const removed: string[] = [];
  for (const relative of prior.managed.files) {
    const target = path.resolve(cwd, relative);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      removed.push(relative);
    }
  }
  return removed;
}

export function writeLayout(
  scan: ScanResult,
  outDir: string,
  options: WriteLayoutOptions,
): WriteLayoutResult {
  const removed = cleanPrior(outDir, options.cwd);
  const emitted = emitLayout(scan, outDir, {
    structural: options.structural,
    enforcers: options.enforcers,
    only: options.only,
    ruleIds: options.ruleIds,
    expand: options.expand,
    graph: options.graph,
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
      managed,
    ),
  );
  return { files, removed, readme, configPath };
}
