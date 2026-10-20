/**
 * The npm package an import specifier names, or null for a relative path, a Node builtin, a tsconfig alias, a
 * `#` subpath import, or a `scheme:` specifier. Self-contained: the generated ESLint rules embed it.
 */
export function packageName(
  specifier: string,
  aliasPrefixes: readonly string[],
  builtins: ReadonlySet<string>,
): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('#')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return null;
  if (builtins.has(specifier) || builtins.has(specifier.split('/')[0]!)) return null;
  if (aliasPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))) {
    return null;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** The package names a package.json text declares in any dependency field. Self-contained: see packageName. */
export function declaredPackages(packageJsonText: string): string[] {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(packageJsonText) as Record<string, unknown>;
  } catch {
    return [];
  }
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
    (field) => {
      const deps = json[field];
      return deps !== null && typeof deps === 'object' ? Object.keys(deps) : [];
    },
  );
}
