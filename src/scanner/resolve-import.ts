import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { aliasPath, matchingAliases } from '../detector/layer-paths.js';

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

/** The source file an import names: a relative path, else the first alias target with a file, as TypeScript tries them. */
export function resolveFirstPartyImport(
  specifier: string,
  fromAbsPath: string,
  aliases: readonly AliasEntry[],
): string | null {
  const bases = specifier.startsWith('.')
    ? [path.resolve(path.dirname(fromAbsPath), specifier)]
    : matchingAliases(specifier, aliases).flatMap((alias) => {
        const target = aliasPath(alias, specifier);
        return target === null ? [] : [path.resolve(target)];
      });
  for (const base of bases) {
    const file = firstPartyCandidates(base).find((candidate) => existsSync(candidate));
    if (file !== undefined) return file;
  }
  return null;
}
