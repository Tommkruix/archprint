import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { detectEnforcers } from '../scanner/enforcers.js';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import { hasTsConfig, scanRepo } from './scan.js';
import { buildRecommendations, detectStack } from './recommend.js';
import { renderAdoptionBody } from './report.js';
import { writeLayout } from './layout.js';
import { ARCHPRINT_DIR, DEPCRUISE_FILE, ESLINT_FILE, collectEnforcement } from './generate.js';
import { CONFIG_FILE } from './archprint-config.js';
import { ownedPath, staysInsideItsFolder } from '../generator/owned-paths.js';
import { OUTPUTS_MANIFEST_FILE, readOutputs, removeIfEmpty } from './outputs-manifest.js';
import {
  MANAGED_START,
  WIRING_TOOLS,
  importReference,
  findEslintConfig,
  rewriteEslintReference,
} from './wiring.js';

export const LEGACY_DIR = 'archprint-rules';
export const LEGACY_CONFIG = 'archprint.json';

const LEGACY_IMPORT = /from (['"`])[^'"`]*(?:archprint-rules|\.archprint\.mjs)[^'"`]*\1/;

interface ConfigEdit {
  path: string;
  content: string;
}

export interface MigratePlan {
  legacy: string[];
  legacyDir: string;
  appDir: string;
  eslintEdit: ConfigEdit | null;
  depcruiseEdit: ConfigEdit | null;
  abort: string | null;
}

function legacyOut(cwd: string): string {
  const configPath = path.join(cwd, LEGACY_CONFIG);
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { rulesDir?: string };
      const recorded = typeof parsed.rulesDir === 'string' ? ownedPath(cwd, parsed.rulesDir) : null;
      if (recorded !== null) return recorded;
    } catch {
      /* fall through to the default legacy dir */
    }
  }
  return path.join(cwd, LEGACY_DIR);
}

function legacyArtifacts(cwd: string): string[] {
  const out = legacyOut(cwd);
  const outputs = readOutputs(out).map((relative) => ownedPath(out, relative));
  return [
    path.join(cwd, LEGACY_CONFIG),
    ...outputs.filter((target): target is string => target !== null),
    ownedPath(out, OUTPUTS_MANIFEST_FILE),
  ].filter((target): target is string => target !== null && existsSync(target));
}

function resolveAppDir(cwd: string): string {
  const configPath = path.join(cwd, LEGACY_CONFIG);
  let input = '.';
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { app?: string };
      if (typeof parsed.app === 'string') input = parsed.app;
    } catch {
      /* fall through to discovery */
    }
  }
  const appDir = path.resolve(cwd, input);
  if (hasTsConfig(appDir)) return appDir;
  const discovered = discoverAppDirs(cwd);
  return discovered[0] ?? appDir;
}

function planEslintEdit(cwd: string): { edit: ConfigEdit | null; abort: string | null } {
  const configPath = findEslintConfig(cwd);
  if (!configPath) return { edit: null, abort: null };
  const content = readFileSync(configPath, 'utf8');
  const newRef = importReference(
    path.dirname(configPath),
    path.join(cwd, ARCHPRINT_DIR, ESLINT_FILE),
  );
  const rel = path.relative(cwd, configPath);
  const cannotRetarget = `${rel} could not be retargeted automatically. Update its archprint import to '${newRef}', then re-run 'archprint migrate'.`;
  if (content.includes(MANAGED_START)) {
    const next = rewriteEslintReference(content, newRef);
    return LEGACY_IMPORT.test(next)
      ? { edit: null, abort: cannotRetarget }
      : { edit: { path: configPath, content: next }, abort: null };
  }
  if (/from (['"`])[^'"`]*eslint-plugin\.archprint\.mjs\1/.test(content)) {
    return {
      edit: null,
      abort: `${rel} imports eslint-plugin.archprint.mjs directly. Update that import to '${newRef}' (its default export is the full config), then re-run 'archprint migrate'.`,
    };
  }
  if (/from (['"`])[^'"`]*eslint-preset\.archprint\.mjs\1/.test(content)) {
    const next = content.replace(
      /(from )(['"`])[^'"`]*eslint-preset\.archprint\.mjs\2/,
      `$1$2${newRef}$2`,
    );
    return LEGACY_IMPORT.test(next)
      ? { edit: null, abort: cannotRetarget }
      : { edit: { path: configPath, content: next }, abort: null };
  }
  return LEGACY_IMPORT.test(content)
    ? { edit: null, abort: cannotRetarget }
    : { edit: null, abort: null };
}

function planDepcruiseEdit(cwd: string): { edit: ConfigEdit | null; abort: string | null } {
  const tool = WIRING_TOOLS.find((candidate) => candidate.name === 'dependency-cruiser')!;
  const configPath = tool.findConfig(cwd);
  if (!configPath) return { edit: null, abort: null };
  const content = readFileSync(configPath, 'utf8');
  const newRef = importReference(
    path.dirname(configPath),
    path.join(cwd, ARCHPRINT_DIR, DEPCRUISE_FILE),
  );
  if (!tool.canEdit(configPath)) {
    return content.includes('archprint')
      ? {
          edit: null,
          abort: `${path.relative(cwd, configPath)} is not JSON and cannot be edited automatically. Change its archprint extends to '${newRef}', then re-run 'archprint migrate'.`,
        }
      : { edit: null, abort: null };
  }
  if (!tool.isWired(content)) return { edit: null, abort: null };
  const result = tool.apply(content, newRef);
  return {
    edit: result.changed ? { path: configPath, content: result.content! } : null,
    abort: null,
  };
}

export function hasLegacyLayout(cwd: string): boolean {
  return legacyArtifacts(cwd).length > 0;
}

export function planMigration(cwd: string): MigratePlan | null {
  const legacy = legacyArtifacts(cwd);
  if (legacy.length === 0) return null;
  const eslint = planEslintEdit(cwd);
  const depcruise = planDepcruiseEdit(cwd);
  return {
    legacy,
    legacyDir: legacyOut(cwd),
    appDir: resolveAppDir(cwd),
    eslintEdit: eslint.edit,
    depcruiseEdit: depcruise.edit,
    abort: eslint.abort ?? depcruise.abort,
  };
}

export interface MigrateResult {
  status: 'migrated' | 'nothing' | 'aborted';
  reason?: string;
  written: string[];
  removed: string[];
  edited: string[];
}

export function runMigration(
  cwd: string,
  version: string,
  options: { dryRun?: boolean } = {},
): MigrateResult {
  const plan = planMigration(cwd);
  if (plan === null) return { status: 'nothing', written: [], removed: [], edited: [] };
  if (plan.abort !== null) {
    return { status: 'aborted', reason: plan.abort, written: [], removed: [], edited: [] };
  }
  const scan = scanRepo(plan.appDir, { deep: true });
  const enforcers = detectEnforcers(scan.appDir);
  const collected = collectEnforcement(scan, { enforcers });
  const willEmitEslint = collected.eslintSpecs.length > 0 || collected.eslintBlocks.length > 0;
  const willEmitDepcruise = collected.depcruise.length > 0;
  const emitAbort = emitMismatch(plan, willEmitEslint, willEmitDepcruise, cwd);
  if (emitAbort !== null) {
    return { status: 'aborted', reason: emitAbort, written: [], removed: [], edited: [] };
  }
  const edits = [plan.eslintEdit, plan.depcruiseEdit].filter(
    (edit): edit is ConfigEdit => edit !== null,
  );
  const removed = plan.legacy.map((target) => path.relative(cwd, target));
  const edited = edits.map((edit) => path.relative(cwd, edit.path));
  if (options.dryRun) {
    const written = [
      ...(willEmitEslint ? [path.join(ARCHPRINT_DIR, ESLINT_FILE)] : []),
      ...(willEmitDepcruise ? [path.join(ARCHPRINT_DIR, DEPCRUISE_FILE)] : []),
      path.join(ARCHPRINT_DIR, CONFIG_FILE),
    ];
    return { status: 'migrated', written, removed, edited };
  }
  const recommendations = buildRecommendations(scan, detectStack(plan.appDir), enforcers);
  const { files } = writeLayout(scan, path.join(cwd, ARCHPRINT_DIR), {
    enforcers,
    mode: 'deep',
    version,
    recommendations,
    app: path.relative(cwd, plan.appDir) || '.',
    cwd,
    readmeBody: renderAdoptionBody(recommendations),
  });
  for (const edit of edits)
    if (staysInsideItsFolder(edit.path)) writeFileSync(edit.path, edit.content);
  for (const target of plan.legacy) rmSync(target, { recursive: true, force: true });
  removeIfEmpty(plan.legacyDir);
  return {
    status: 'migrated',
    written: files.map((file) => path.relative(cwd, file)),
    removed,
    edited,
  };
}

function emitMismatch(
  plan: MigratePlan,
  willEmitEslint: boolean,
  willEmitDepcruise: boolean,
  cwd: string,
): string | null {
  if (plan.eslintEdit && !willEmitEslint) {
    return `${path.relative(cwd, plan.eslintEdit.path)} references archprint, but this repo no longer produces ESLint rules under the current defaults (structural families are held for review). Review with 'archprint scan', or run 'archprint eject' on the old layout, before migrating.`;
  }
  if (plan.depcruiseEdit && !willEmitDepcruise) {
    return `${path.relative(cwd, plan.depcruiseEdit.path)} references archprint, but this repo no longer produces dependency-cruiser rules under the current defaults (structural families are held for review). Review with 'archprint scan', or run 'archprint eject' on the old layout, before migrating.`;
  }
  return null;
}
