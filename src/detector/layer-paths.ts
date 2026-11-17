/**
 * Layer placement and import resolution shared by the detectors and the generated ESLint rules. Each function is
 * self-contained (no imports; only other functions of this file) because the generator emits its source verbatim.
 */

export interface LayerAlias {
  prefix: string;
  dir: string;
}

export interface LayerRoot {
  layer: string;
  dir: string;
}

/** The layer a file belongs to: its first directory that is a router root or not structural, and that folder. */
export function layerRootOf(relativePath: string): LayerRoot | null {
  const routerRoots = ['app', 'pages'];
  const structural =
    /^(?:src|dist|build|public|test|tests|__tests__|node_modules|.*\..*|\(.*\)|\[.*\]|@.*)$/;
  const segments = relativePath.split('/');
  const index = segments.findIndex(
    (segment) => routerRoots.includes(segment) || !structural.test(segment),
  );
  return index === -1
    ? null
    : { layer: segments[index]!, dir: segments.slice(0, index + 1).join('/') };
}

/** The app-relative path an import points at, or null for a package or a path outside the app. */
export function resolveImportPath(
  fileRelativePath: string,
  specifier: string,
  aliases: readonly LayerAlias[],
): string | null {
  let base: string;
  let rest: string;
  if (specifier.startsWith('.')) {
    base = fileRelativePath.split('/').slice(0, -1).join('/');
    rest = specifier;
  } else {
    const alias = aliases.find(
      ({ prefix }) => specifier === prefix || specifier.startsWith(`${prefix}/`),
    );
    if (alias === undefined) return null;
    base = alias.dir;
    rest = specifier.slice(alias.prefix.length);
  }
  const segments: string[] = [];
  for (const segment of `${base}/${rest}`.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') segments.push(segment);
    else if (segments.pop() === undefined) return null;
  }
  return segments.join('/');
}

/** A key of a package's `exports` (`./x`) or `imports` (`#x`), or a pattern with one `*`, with its target paths from the root. */
export interface PackageSubpath {
  key: string;
  targets: string[];
}

/**
 * A workspace package by repo-relative directory, with the source file its root import resolves to, if known, and
 * its subpath exports in the order Node.js matches them.
 */
export interface WorkspacePackage {
  name: string;
  dir: string;
  entry: string | null;
  subpaths: PackageSubpath[];
}

/**
 * The `exports` or `imports` key Node.js matches a subpath (`./x`, `#x`) with: an exact key, else the first `*` pattern, `subpaths` being
 * in Node's order (exact keys first, then the most specific pattern); the `*` stands for at least one character.
 */
export function matchingSubpath(
  subpaths: readonly PackageSubpath[],
  subpath: string,
): PackageSubpath | undefined {
  return subpaths.find(({ key }) => {
    const star = key.indexOf('*');
    return star === -1
      ? key === subpath
      : subpath.length >= key.length &&
          subpath.startsWith(key.slice(0, star)) &&
          subpath.endsWith(key.slice(star + 1));
  });
}

/**
 * A package.json directory, repo-relative, with its `imports` keys (`#x`, `#x/*`) in the order Node.js matches them.
 * One without `imports` still ends the lookup: Node.js reads only the package.json nearest to the importing file.
 */
export interface PackageScope {
  dir: string;
  imports: PackageSubpath[];
}

/**
 * The repo-relative module an import names, first hop, as written: a relative or tsconfig-alias path (aliases win
 * over `imports`, as in TypeScript), a `#` import (the first target of the key it matches in the nearest package.json's `imports` that names a source file, else
 * null), or a workspace package (its entry for the root import; its directory with a trailing `/` when the entry is
 * unknown; for a subpath, the first target of the `exports` key it matches that names a source file, else the path
 * under the package directory). `scopes` come deepest first. `fileFor` picks the source file a path names, if any
 * (`x` may be `x.ts` or `x/index.ts`); else the bare path stands. Null for a package outside the repository.
 */
export function resolveImportTarget(
  fromPath: string,
  specifier: string,
  aliases: readonly LayerAlias[],
  packages: readonly WorkspacePackage[],
  scopes: readonly PackageScope[],
  fileFor: (base: string) => string | null,
): string | null {
  const subpathFile = (subpaths: readonly PackageSubpath[], subpath: string): string | null => {
    const matched = matchingSubpath(subpaths, subpath);
    if (matched === undefined) return null;
    const star = matched.key.indexOf('*');
    const expand = (target: string): string =>
      star === -1
        ? target
        : target
            .split('*')
            .join(subpath.slice(star, subpath.length - matched.key.length + star + 1));
    for (const target of matched.targets) {
      const file = fileFor(expand(target));
      if (file !== null) return file;
    }
    return null;
  };
  let base = resolveImportPath(fromPath, specifier, aliases);
  if (base === null && specifier.startsWith('#')) {
    const scope = scopes.find(({ dir }) => dir === '' || fromPath.startsWith(`${dir}/`));
    return scope === undefined ? null : subpathFile(scope.imports, specifier);
  }
  if (base === null) {
    const owner = packages.find(
      ({ name }) => specifier === name || specifier.startsWith(`${name}/`),
    );
    if (owner === undefined) return null;
    if (specifier === owner.name) return owner.entry ?? `${owner.dir}/`;
    const exported = subpathFile(owner.subpaths, `.${specifier.slice(owner.name.length)}`);
    if (exported !== null) return exported;
    base = `${owner.dir}${specifier.slice(owner.name.length)}`;
  }
  return fileFor(base) ?? base;
}
