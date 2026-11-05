import * as path from 'node:path';
import { firstPartyCandidates } from '../scanner/resolve-import.js';
import type { PackageSubpath } from './layer-paths.js';

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

const isDeclarationFile = (target: string): boolean => /\.d\.[cm]?ts$/.test(target);

/** Targets in the order written, declaration files last: one in `dist` exists only after a build. */
const declarationsLast = (targets: string[]): string[] => [
  ...targets.filter((target) => !isDeclarationFile(target)),
  ...targets.filter(isDeclarationFile),
];

/**
 * The source file a package's root import resolves to: the paths in `exports['.']`, then `types`, `typings`, `main`
 * and `module` (each mapped from `.js` to its `.ts` source, declaration files last), then an `index` file; null when
 * none is a known file.
 */
export function packageEntry(
  packageJson: unknown,
  dir: string,
  isFile: (candidate: string) => boolean,
): string | null {
  const fields = isRecord(packageJson) ? packageJson : {};
  const paths = declarationsLast([
    ...stringLeaves(rootExport(fields.exports)),
    ...['types', 'typings', 'main', 'module'].flatMap((field) => stringLeaves(fields[field])),
  ]);
  const candidates = [
    ...paths.flatMap((entry) => firstPartyCandidates(path.posix.join(dir, entry))),
    ...firstPartyCandidates(dir),
  ];
  return candidates.find(isFile) ?? null;
}

/**
 * A package's subpath exports as Node.js matches them: exact `./x` keys, then keys with one `*` from the most specific
 * (the longest part before `*`, then the longest key). Each target that is a relative path (`./...`) is kept from the
 * root, in the order written with declaration files last; `null` targets leave the key with none.
 */
export function packageSubpaths(packageJson: unknown, dir: string): PackageSubpath[] {
  const exportsField = isRecord(packageJson) ? packageJson.exports : undefined;
  if (!isRecord(exportsField)) return [];
  const keys = Object.keys(exportsField).filter(
    (key) => key.startsWith('./') && !key.endsWith('/') && key.split('*').length <= 2,
  );
  const prefixLength = (key: string): number => key.indexOf('*');
  const patterns = keys
    .filter((key) => key.includes('*'))
    .sort((a, b) => prefixLength(b) - prefixLength(a) || b.length - a.length);
  return [...keys.filter((key) => !key.includes('*')), ...patterns].map((key) => ({
    key,
    targets: declarationsLast(
      stringLeaves(exportsField[key]).filter((target) => target.startsWith('./')),
    ).map((target) => path.posix.join(dir, target)),
  }));
}

/** The source file among a path's candidates (`x.ts`, `x/index.ts`, ...) that `isFile` accepts, if any. */
export const sourceFileFor =
  (isFile: (candidate: string) => boolean) =>
  (base: string): string | null =>
    firstPartyCandidates(base).find(isFile) ?? null;
