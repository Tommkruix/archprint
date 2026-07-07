import * as path from 'node:path';
import * as ts from 'typescript';

/**
 * Resolve the workspace alias map declared in a repo's `tsconfig.json`.
 *
 * Why the TypeScript compiler API instead of reading + regex-stripping the JSON
 * (as the original plan sketched): real repos use JSON with comments, trailing
 * commas, `extends` chains, and `baseUrl`. A regex approach silently misses all
 * of those. inbox-zero in particular is a Turborepo whose configs extend shared
 * bases, so the aliases we care about can live in a parent config. `ts` reads
 * exactly what the TypeScript compiler itself would, which is the only way to be
 * correct. This mirrors our project rule: never regex-parse; use the real parser.
 *
 * Returns a map of alias (with any trailing `/*` removed) to the absolute path of
 * its FIRST mapped target. Returns an empty object if the config is missing,
 * unreadable, or declares no `paths`.
 */
export function buildWorkspaceMap(rootDir: string): Record<string, string> {
  const configPath = path.join(rootDir, 'tsconfig.json');
  if (!ts.sys.fileExists(configPath)) {
    return {};
  }

  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readResult.error !== undefined) {
    return {};
  }

  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, path.dirname(configPath));

  const options = parsed.options;
  const paths = options.paths ?? {};

  // Where are `paths` targets resolved from? If `baseUrl` is set, targets are
  // relative to it. Otherwise (TS 4.1+ allows `paths` without `baseUrl`) they
  // are relative to the directory of the config that declared them, which the
  // compiler exposes internally as `pathsBasePath`. Fall back to the config dir.
  const pathsBasePath = (options as { pathsBasePath?: string }).pathsBasePath;
  const base = options.baseUrl ?? pathsBasePath ?? path.dirname(configPath);

  const map: Record<string, string> = {};
  for (const [alias, targets] of Object.entries(paths)) {
    const firstTarget = targets?.[0];
    if (firstTarget === undefined) {
      continue;
    }
    const cleanAlias = alias.replace(/\/\*$/, '');
    const cleanTarget = firstTarget.replace(/\/\*$/, '');
    map[cleanAlias] = path.resolve(base, cleanTarget);
  }

  return map;
}
