/**
 * Layer placement and import resolution shared by the layer detector and the generated ESLint rule. Each function
 * is self-contained (no imports, no outer references) because the generator emits its source verbatim.
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
