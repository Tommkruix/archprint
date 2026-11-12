import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { isSourceFileName } from './source-paths.js';

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

function parseConfig(configPath: string): ts.ParsedCommandLine | null {
  if (!ts.sys.fileExists(configPath)) return null;
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readResult.error !== undefined) return null;
  return ts.parseJsonConfigFileContent(readResult.config, ts.sys, path.dirname(configPath));
}

/** Whether `dir` holds the tsconfig.json nearest to `file`, the config TypeScript looks at first. */
function isNearestConfigDir(dir: string, file: string): boolean {
  const relative = path.relative(dir, path.dirname(file));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return false;
  }
  const segments = relative === '' ? [] : relative.split(path.sep);
  return !segments.some((_, depth) =>
    ts.sys.fileExists(path.join(dir, ...segments.slice(0, depth + 1), 'tsconfig.json')),
  );
}

interface TsProject {
  configPath: string;
  config: ts.ParsedCommandLine;
}

interface OwningProjects {
  root: TsProject;
  /** The direct references that compile files of the directory, in the order the config lists them. */
  references: TsProject[];
}

function readProject(configPath: string): TsProject | null {
  const config = parseConfig(configPath);
  return config === null ? null : { configPath, config };
}

/**
 * The projects TypeScript compiles a directory's files with: its tsconfig.json, and each project it references that
 * includes a file whose nearest tsconfig.json is that one (a solution-style config such as create-vite's owns no
 * files itself). Direct references only, as oxc-resolver does.
 */
function owningProjects(appDir: string): OwningProjects | null {
  const dir = path.resolve(appDir);
  const root = readProject(path.join(dir, 'tsconfig.json'));
  if (root === null) return null;
  const references = (root.config.projectReferences ?? [])
    .map((reference) => readProject(ts.resolveProjectReferencePath(reference)))
    .filter((reference): reference is TsProject => reference !== null)
    .filter((reference) =>
      reference.config.fileNames.some((file) => isNearestConfigDir(dir, path.resolve(file))),
    );
  return { root, references };
}

/**
 * A `paths` key whose `*` follows its prefix directly (`"@*": ["./src/*"]`, so `@components/x` is `src/components/x`):
 * one alias per folder and source file of the target, the way `baseUrl` folders become aliases, and the prefix itself,
 * since TypeScript also matches `@/components/x` (the `*` taking the slash).
 */
function gluedPatternAliases(prefix: string, targetDir: string): Record<string, string> {
  const map: Record<string, string> = prefix === '' ? {} : { [prefix]: targetDir };
  let entries;
  try {
    entries = readdirSync(targetDir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  } catch {
    return map;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      map[prefix + entry.name] = path.resolve(targetDir, entry.name);
    } else if (entry.isFile() && isSourceFileName(entry.name)) {
      const stem = entry.name.replace(/\.[^.]+$/, '');
      map[prefix + stem] = path.resolve(targetDir, stem);
    }
  }
  return map;
}

function configAliases({ configPath, config }: TsProject): Record<string, string> {
  const options = config.options;
  const paths = options.paths ?? {};

  const pathsBasePath = (options as { pathsBasePath?: string }).pathsBasePath;
  const base = options.baseUrl ?? pathsBasePath ?? path.dirname(configPath);

  const map: Record<string, string> = {};
  for (const [alias, targets] of Object.entries(paths)) {
    const firstTarget = targets?.[0];
    if (firstTarget === undefined) {
      continue;
    }
    if (alias.endsWith('*') && !alias.endsWith('/*') && firstTarget.endsWith('/*')) {
      const glued = gluedPatternAliases(
        alias.slice(0, -1),
        path.resolve(base, firstTarget.slice(0, -2)),
      );
      for (const [key, dir] of Object.entries(glued)) map[key] ??= dir;
      continue;
    }
    const cleanAlias = alias.replace(/\/\*$/, '');
    const cleanTarget = firstTarget.replace(/\/\*$/, '');
    map[cleanAlias] = path.resolve(base, cleanTarget);
  }

  if (options.baseUrl !== undefined) {
    try {
      const entries = readdirSync(options.baseUrl, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        if (map[entry.name] === undefined)
          map[entry.name] = path.resolve(options.baseUrl, entry.name);
      }
    } catch {
      /* v8 ignore next -- unreadable baseUrl dir contributes no first-party prefixes */
    }
  }

  return map;
}

/** The aliases the references add: those the root does not map, unless two references map them differently. */
function referencedAliases(
  references: readonly TsProject[],
  rootAliases: Record<string, string>,
): Record<string, string> {
  const added: Record<string, string> = {};
  const ambiguous = new Set<string>();
  for (const reference of references) {
    for (const [alias, target] of Object.entries(configAliases(reference))) {
      if (Object.hasOwn(rootAliases, alias)) continue;
      if (Object.hasOwn(added, alias) && added[alias] !== target) ambiguous.add(alias);
      added[alias] ??= target;
    }
  }
  for (const alias of ambiguous) delete added[alias];
  return added;
}

export function buildWorkspaceMap(rootDir: string): Record<string, string> {
  const projects = owningProjects(rootDir);
  if (projects === null) {
    return {};
  }

  const rootAliases = configAliases(projects.root);
  const map = { ...rootAliases, ...referencedAliases(projects.references, rootAliases) };

  const self = ownPackageName(rootDir);
  if (self !== null && map[self] === undefined) map[self] = path.resolve(rootDir);

  return map;
}

/**
 * The tsconfig TypeScript compiles a file of `appDir` with: the first of its tsconfig.json and the references that
 * include the file, else its tsconfig.json.
 */
export function owningConfigPath(appDir: string): (file: string) => string {
  const rootConfig = path.join(path.resolve(appDir), 'tsconfig.json');
  const projects = owningProjects(appDir);
  if (projects === null || projects.references.length === 0) return () => rootConfig;
  const owners = [projects.root, ...projects.references].map(({ configPath, config }) => ({
    configPath,
    files: new Set(config.fileNames.map((file) => path.resolve(file))),
  }));
  return (file) => {
    const absolute = path.resolve(file);
    return owners.find(({ files }) => files.has(absolute))?.configPath ?? rootConfig;
  };
}
