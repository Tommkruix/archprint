import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { removeOwnedFile } from '../generator/owned-paths.js';
import { configPath, readConfig, readConfigSection, updateConfig } from './archprint-config.js';

/** Where 0.11.x kept the allowed exceptions, before they moved into config.json. */
export const LEGACY_ALLOW_FILE = 'allow.json';
const LEGACY_ALLOW_FORMAT = 1;

const MAX_REASON = 500;

export interface AllowedException {
  rule: string;
  file: string;
  reason: string;
}

export class InvalidAllowError extends Error {}

export const allowKey = (rule: string, file: string): string => `${rule}\u0000${file}`;

const isRelativePosixPath = (file: string): boolean =>
  file !== '' &&
  !file.includes('\\') &&
  !/[*?[\]{}!]/.test(file) &&
  !path.posix.isAbsolute(file) &&
  !file.split('/').some((segment) => segment === '..' || segment === '.' || segment === '');

function validateEntry(entry: unknown, source: string): AllowedException {
  const { rule, file, reason } = (entry ?? {}) as Partial<Record<keyof AllowedException, unknown>>;
  if (typeof rule !== 'string' || rule.trim() === '') {
    throw new InvalidAllowError(`${source}: every entry needs the rule id it allows.`);
  }
  if (typeof file !== 'string' || !isRelativePosixPath(file)) {
    throw new InvalidAllowError(
      `${source}: "${String(file)}" must be a file path relative to the app, using forward slashes.`,
    );
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new InvalidAllowError(`${source}: ${rule} in ${file} needs a reason.`);
  }
  if (reason.length > MAX_REASON) {
    throw new InvalidAllowError(
      `${source}: the reason for ${rule} in ${file} is over ${MAX_REASON} characters.`,
    );
  }
  return { rule, file, reason: reason.trim() };
}

function parseAllowedList(entries: unknown, source: string): AllowedException[] {
  if (!Array.isArray(entries)) {
    throw new InvalidAllowError(`${source} was written by a different archprint version.`);
  }
  const parsed = entries.map((entry) => validateEntry(entry, source));
  const keys = new Set<string>();
  for (const entry of parsed) {
    const key = allowKey(entry.rule, entry.file);
    if (keys.has(key)) {
      throw new InvalidAllowError(`${source} lists ${entry.rule} in ${entry.file} twice.`);
    }
    keys.add(key);
  }
  return parsed;
}

/** The entries of a legacy allow.json. */
export function parseLegacyAllowed(text: string, source: string): AllowedException[] {
  let parsed: { format?: unknown; entries?: unknown };
  try {
    parsed = JSON.parse(text) as { format?: unknown; entries?: unknown };
  } catch {
    throw new InvalidAllowError(`${source} is not valid JSON.`);
  }
  return parseAllowedList(
    parsed.format === LEGACY_ALLOW_FORMAT ? parsed.entries : undefined,
    source,
  );
}

/** The allowed exceptions: config.json's allowed section, else a legacy allow.json, else none. */
export function readAllowed(outDir: string): AllowedException[] {
  const entries = readConfigSection(outDir, 'allowed');
  if (entries !== undefined) return parseAllowedList(entries, configPath(outDir));
  const legacy = path.join(outDir, LEGACY_ALLOW_FILE);
  return existsSync(legacy) ? parseLegacyAllowed(readFileSync(legacy, 'utf8'), legacy) : [];
}

const byRuleThenFile = (a: AllowedException, b: AllowedException): number =>
  a.rule === b.rule ? (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) : a.rule < b.rule ? -1 : 1;

export const sortAllowed = (entries: readonly AllowedException[]): AllowedException[] =>
  [...entries].sort(byRuleThenFile);

/** Records the entries in config.json, which then supersedes any legacy allow.json. */
export function writeAllowed(outDir: string, entries: readonly AllowedException[]): string {
  if (readConfig(outDir) === null) {
    throw new InvalidAllowError(`${configPath(outDir)} is missing.`);
  }
  const file = updateConfig(outDir, { allowed: sortAllowed(entries) });
  removeOwnedFile(outDir, path.join(outDir, LEGACY_ALLOW_FILE));
  return file;
}

export function allowedFilesByRule(
  entries: readonly AllowedException[],
): ReadonlyMap<string, readonly string[]> {
  const byRule = new Map<string, string[]>();
  for (const entry of entries)
    byRule.set(entry.rule, [...(byRule.get(entry.rule) ?? []), entry.file]);
  return byRule;
}
