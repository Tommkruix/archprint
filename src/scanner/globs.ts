import picomatch from 'picomatch';

/** A glob compiled to a regular expression, as `source` and `flags`, so a generated ESLint rule can rebuild it. */
export interface GlobPattern {
  source: string;
  flags: string;
}

/** Dotfiles match, as in ESLint's `files` and `ignores` (@eslint/config-array). */
const GLOB_OPTIONS = { dot: true } as const;

/** A pattern no path matches: what ESLint's minimatch makes of an empty glob or a `#` comment. */
const NEVER: GlobPattern = { source: '$.', flags: '' };

const compiled = new Map<string, RegExp>();

/**
 * A glob as the one regular expression the scan, `check` and the generated ESLint rules all test, so they agree
 * on every path. A leading `./` is dropped, as ESLint drops it.
 */
export function globPattern(glob: string): GlobPattern {
  const pattern = glob.replace(/^\.\//, '');
  if (pattern === '' || pattern.startsWith('#')) return NEVER;
  const regex = picomatch.makeRe(pattern, GLOB_OPTIONS);
  return { source: regex.source, flags: regex.flags };
}

function regexFor(glob: string): RegExp {
  let regex = compiled.get(glob);
  if (regex === undefined) {
    const { source, flags } = globPattern(glob);
    regex = new RegExp(source, flags);
    compiled.set(glob, regex);
  }
  return regex;
}

/** Whether a forward-slash path matches a glob. */
export const matchesGlob = (filePath: string, glob: string): boolean =>
  regexFor(glob).test(filePath);

export const matchesAnyGlob = (filePath: string, globs: readonly string[]): boolean =>
  globs.some((glob) => matchesGlob(filePath, glob));
