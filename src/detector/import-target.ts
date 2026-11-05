import * as path from 'node:path';
import { firstPartyCandidates } from '../scanner/resolve-import.js';

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

/** The source file among a path's candidates (`x.ts`, `x/index.ts`, ...) that `isFile` accepts, if any. */
export const sourceFileFor =
  (isFile: (candidate: string) => boolean) =>
  (base: string): string | null =>
    firstPartyCandidates(base).find(isFile) ?? null;
