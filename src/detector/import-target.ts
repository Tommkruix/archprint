import * as path from 'node:path';
import { type LayerAlias, resolveImportPath } from './layer-paths.js';
import { firstPartyCandidates } from '../scanner/resolve-import.js';

/** A workspace package by repo-relative directory, with the source file its root import resolves to, if known. */
export interface WorkspacePackage {
  name: string;
  dir: string;
  entry: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringLeaves = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(stringLeaves)
      : isRecord(value)
        ? Object.values(value).flatMap(stringLeaves)
        : [];

/** `exports['.']`, or `exports` itself when it is a string, a list or a conditions object. */
function rootExport(exportsField: unknown): unknown {
  if (!isRecord(exportsField)) return exportsField;
  return Object.keys(exportsField).some((key) => key.startsWith('.'))
    ? exportsField['.']
    : exportsField;
}

/**
 * The source file a package's root import resolves to: the paths in `exports['.']`, then `types`, `typings`, `main`
 * and `module` (each mapped from `.js` to its `.ts` source), then an `index` file; null when none is a known file.
 */
export function packageEntry(
  packageJson: unknown,
  dir: string,
  isFile: (candidate: string) => boolean,
): string | null {
  const fields = isRecord(packageJson) ? packageJson : {};
  const paths = [
    ...stringLeaves(rootExport(fields.exports)),
    ...['types', 'typings', 'main', 'module'].flatMap((field) => stringLeaves(fields[field])),
  ];
  const candidates = [
    ...paths.flatMap((entry) => firstPartyCandidates(path.posix.join(dir, entry))),
    ...firstPartyCandidates(dir),
  ];
  return candidates.find(isFile) ?? null;
}

/**
 * The repo-relative module an import names, first hop, as written: a relative or tsconfig-alias path, or a
 * workspace package (its entry for the root import; its directory with a trailing `/` when the entry is unknown).
 * A known source file is preferred over the bare path; null for a package outside the repository.
 */
export function resolveImportTarget(
  fromPath: string,
  specifier: string,
  aliases: readonly LayerAlias[],
  packages: readonly WorkspacePackage[],
  isFile: (candidate: string) => boolean,
): string | null {
  let base = resolveImportPath(fromPath, specifier, aliases);
  if (base === null) {
    const owner = packages.find(
      ({ name }) => specifier === name || specifier.startsWith(`${name}/`),
    );
    if (owner === undefined) return null;
    if (specifier === owner.name) return owner.entry ?? `${owner.dir}/`;
    base = `${owner.dir}${specifier.slice(owner.name.length)}`;
  }
  return firstPartyCandidates(base).find(isFile) ?? base;
}
