import { existsSync } from 'node:fs';
import * as path from 'node:path';

export interface AliasEntry {
  prefix: string;
  dir: string;
}

const JS_EXT_TO_TS: Record<string, readonly string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.ts', '.tsx'],
  '.cjs': ['.ts', '.tsx'],
};
const BARE_CANDIDATES = ['', '.ts', '.tsx', '.vue', '.svelte', '/index.ts', '/index.tsx'];
const FIRST_PARTY_TARGET = /\.(ts|tsx|vue|svelte)$/;

function specifierBase(
  specifier: string,
  fromAbsPath: string,
  aliases: readonly AliasEntry[],
): string | null {
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(fromAbsPath), specifier);
  }
  for (const { prefix, dir } of aliases) {
    if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
      return path.resolve(dir, specifier.slice(prefix.length).replace(/^\//, ''));
    }
  }
  return null;
}

export function resolveFirstPartyImport(
  specifier: string,
  fromAbsPath: string,
  aliases: readonly AliasEntry[],
): string | null {
  const base = specifierBase(specifier, fromAbsPath, aliases);
  if (base === null) return null;
  const candidates: string[] = [];
  const tsExtensions = JS_EXT_TO_TS[path.extname(base)];
  if (tsExtensions !== undefined) {
    const stem = base.slice(0, -path.extname(base).length);
    for (const tsExt of tsExtensions) candidates.push(stem + tsExt);
  }
  for (const suffix of BARE_CANDIDATES) candidates.push(base + suffix);
  for (const candidate of candidates) {
    if (FIRST_PARTY_TARGET.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}
