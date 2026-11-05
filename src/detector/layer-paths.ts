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

/** A workspace package by repo-relative directory, with the source file its root import resolves to, if known. */
export interface WorkspacePackage {
  name: string;
  dir: string;
  entry: string | null;
}

/**
 * The repo-relative module an import names, first hop, as written: a relative or tsconfig-alias path, or a
 * workspace package (its entry for the root import; its directory with a trailing `/` when the entry is unknown).
 * `fileFor` picks the source file a path names, if any (`x` may be `x.ts` or `x/index.ts`); else the bare path
 * stands. Null for a package outside the repository.
 */
export function resolveImportTarget(
  fromPath: string,
  specifier: string,
  aliases: readonly LayerAlias[],
  packages: readonly WorkspacePackage[],
  fileFor: (base: string) => string | null,
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
  return fileFor(base) ?? base;
}
