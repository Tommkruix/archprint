import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { assertRealDirectory, ownedPath } from '../generator/owned-paths.js';
import { type AdoptedRule, readAdoptedRules } from './adopted-rules.js';
import {
  allowKey,
  readAllowed,
  writeAllowed,
  type AllowedException,
} from './allowed-exceptions.js';
import { readConfig } from './archprint-config.js';
import { evaluateRules } from './check-evaluate.js';

export class AllowError extends Error {}

export interface AllowOptions {
  cwd: string;
  out: string;
  rule: string;
  file: string;
  reason?: string;
  remove?: boolean;
}

const GENERATED_FOR_EITHER_ENFORCER: ReadonlySet<AdoptedRule['family']> = new Set([
  'layer',
  'phantom-deps',
  'server-client',
]);

/** Families whose generated dependency-cruiser rules do not read the allowed list. */
const UNEXEMPTED_BY_GENERATE: ReadonlySet<AdoptedRule['family']> = new Set([
  'public-api',
  'role-layering',
  'feature-slice',
  'app-isolation',
  'stories-isolation',
  'ui-data',
]);

/** What to run so the generated rules follow the change; nothing when regenerating would not change them. */
const regenerateHint = (rule: AdoptedRule): string =>
  rule.family === 'cycles' || UNEXEMPTED_BY_GENERATE.has(rule.family)
    ? ''
    : ` Run archprint generate to update the ${GENERATED_FOR_EITHER_ENFORCER.has(rule.family) ? 'generated' : 'ESLint'} rules.`;

const toPosix = (value: string): string => value.split(path.sep).join('/');

export function runAllow(options: AllowOptions): string {
  const outDir = path.resolve(options.cwd, options.out);
  assertRealDirectory(outDir, options.cwd);
  const config = readConfig(outDir);
  const adopted = readAdoptedRules(outDir);
  if (config === null || adopted === null) {
    throw new AllowError('No adopted rules here. Run archprint init (or generate) first.');
  }
  const rule = adopted.find((candidate) => candidate.id === options.rule);
  if (rule === undefined) {
    const known = adopted.map((candidate) => candidate.id).join(', ');
    throw new AllowError(`No adopted rule "${options.rule}". Adopted rules: ${known || 'none'}.`);
  }
  const appDir = path.resolve(options.cwd, config.app);
  const inside = [path.resolve(options.cwd, options.file), path.resolve(appDir, options.file)]
    .map((candidate) => ownedPath(appDir, candidate))
    .filter((candidate): candidate is string => candidate !== null);
  const target = inside.find((candidate) => existsSync(candidate)) ?? inside[0];
  if (target === undefined) {
    throw new AllowError(`${options.file} is not a file inside the app (${config.app}).`);
  }
  const file = toPosix(path.relative(appDir, target));
  const entries = readAllowed(outDir);
  const key = allowKey(rule.id, file);
  const others = entries.filter((entry) => allowKey(entry.rule, entry.file) !== key);

  if (options.remove) {
    if (others.length === entries.length) {
      throw new AllowError(`There is no allowed exception for ${rule.id} in ${file}.`);
    }
    writeAllowed(outDir, others);
    return `Removed the exception for ${rule.id} in ${file}.${regenerateHint(rule)}`;
  }

  const reason = options.reason?.trim() ?? '';
  if (reason === '') {
    throw new AllowError('Give the reason this file is an exception: --reason "..."');
  }
  const reported = evaluateRules(appDir, [rule]).some((finding) => finding.file === file);
  if (!reported) {
    throw new AllowError(`${rule.id} reports nothing in ${file}, so there is nothing to allow.`);
  }
  const entry: AllowedException = { rule: rule.id, file, reason };
  writeAllowed(outDir, [...others, entry]);
  const lint = UNEXEMPTED_BY_GENERATE.has(rule.family)
    ? ' dependency-cruiser does not read this list, so add the exception there too if you use it.'
    : regenerateHint(rule);
  return `Allowed ${rule.id} in ${file}. archprint check accepts it now.${lint}`;
}
