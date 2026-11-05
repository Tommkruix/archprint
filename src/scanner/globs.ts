import { Minimatch } from 'minimatch';

/** ESLint's options for `files` and `ignores` (@eslint/config-array), so archprint and ESLint agree on scope. */
const ESLINT_GLOB_OPTIONS = { dot: true } as const;

const matchers = new Map<string, Minimatch>();

function matcherFor(glob: string): Minimatch {
  const pattern = glob.replace(/^\.\//, '');
  let matcher = matchers.get(pattern);
  if (matcher === undefined) {
    matcher = new Minimatch(pattern, ESLINT_GLOB_OPTIONS);
    matchers.set(pattern, matcher);
  }
  return matcher;
}

/** Whether a forward-slash path matches a glob the way ESLint matches its `files` globs. */
export const matchesGlob = (filePath: string, glob: string): boolean =>
  matcherFor(glob).match(filePath);

export const matchesAnyGlob = (filePath: string, globs: readonly string[]): boolean =>
  globs.some((glob) => matchesGlob(filePath, glob));
