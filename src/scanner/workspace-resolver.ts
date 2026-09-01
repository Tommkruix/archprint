import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

// A package's own name resolves to itself: files commonly self-reference via `@scope/pkg/sub` (npm workspaces
// self-reference) instead of a relative path, and this is not a tsconfig `paths` alias. Without it the resolver
// silently drops these real, first-party imports, undercounting violations (a false-AUTO source) and leaving a
// live enforcement gap. Map the app's own package name to its root so `@scope/pkg/sub` -> <root>/sub.
function ownPackageName(rootDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    return typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : null;
  } catch {
    /* v8 ignore next -- no/unreadable package.json: nothing to self-alias */
    return null;
  }
}

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

  const self = ownPackageName(rootDir);
  if (self !== null && map[self] === undefined) map[self] = path.resolve(rootDir);

  return map;
}
