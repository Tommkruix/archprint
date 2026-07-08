import * as path from 'node:path';
import * as ts from 'typescript';

/**
 * Map each tsconfig `paths` alias (trailing `/*` stripped) to the absolute path of its first
 * target. Empty when the config is missing, unreadable, or declares no paths. Uses the TypeScript
 * config parser, so `extends`, `baseUrl`, comments, and trailing commas are handled.
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

  // baseUrl when set, else the config dir that declared `paths` (TS 4.1+ exposes it as pathsBasePath).
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
