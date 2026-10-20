import { existsSync } from 'node:fs';
import * as path from 'node:path';

export interface AliasEntry {
  prefix: string;
  dir: string;
}

/**
 * The files an import of `base` (a path without resolution) can mean, in the order TypeScript-style resolution
 * tries them. Self-contained: the generated ESLint rules embed it.
 */
export function firstPartyCandidates(base: string): string[] {
  const jsToTs: Record<string, readonly string[]> = {
    '.js': ['.ts', '.tsx'],
    '.jsx': ['.tsx'],
    '.mjs': ['.ts', '.tsx'],
    '.cjs': ['.ts', '.tsx'],
  };
  const name = base.slice(Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  const candidates = (jsToTs[extension] ?? []).map(
    (tsExtension) => base.slice(0, -extension.length) + tsExtension,
  );
  for (const suffix of ['', '.ts', '.tsx', '.vue', '.svelte', '/index.ts', '/index.tsx']) {
    candidates.push(base + suffix);
  }
  return candidates.filter((candidate) => /\.(ts|tsx|vue|svelte)$/.test(candidate));
}

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
  for (const candidate of firstPartyCandidates(base)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
