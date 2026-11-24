import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Minimatch } from 'minimatch';
import * as ts from 'typescript';
import {
  asObject,
  asString,
  callArguments,
  importedNames,
  objectProperty,
  parseScript,
  propertyValues,
} from '../scanner/config-literals.js';
import { declaredPackages } from '../scanner/package-name.js';
import { isSvelteKitProject } from '../scanner/sveltekit.js';
import { findWorkspaceRoot } from '../scanner/workspace-packages.js';
import { CONFIG_FILE } from './reference-graph.js';
import { routify2Pages } from './routify-routes.js';

/** Whether a path from a project folder names a file the framework loads by its location. */
type RoutedFile = (inside: string) => boolean;

/** A folder the frameworks look at, its entries and package.json read once. */
interface Folder {
  dir: string;
  names: () => string[];
  /** Whether its package.json declares any of the packages. */
  declares: (packages: readonly string[]) => boolean;
}

/** The files a project folder's framework loads by their location; null when the folder is not such a project. */
type FileRoutedFramework = (folder: Folder) => RoutedFile | null;

const once = <T>(read: () => T): (() => T) => {
  let value: { read: T } | undefined;
  return () => (value ??= { read: read() }).read;
};

function folderAt(dir: string): Folder {
  const names = once(() => {
    try {
      return readdirSync(dir);
    } catch {
      /* v8 ignore next -- defensive: a folder removed while scanning */
      return [];
    }
  });
  const declared = once(() => {
    try {
      return declaredPackages(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      return [];
    }
  });
  return {
    dir,
    names,
    declares: (packages) => packages.some((name) => declared().includes(name)),
  };
}

/** A setting a config may write: its literal values, the default when none is written, null when one is not a literal. */
function literalSetting(values: readonly (string | null)[], fallback: string): string[] | null {
  if (values.includes(null)) return null;
  return values.length === 0 ? [fallback] : [...new Set(values as string[])];
}

/** A folder path as written in a config (`./src/routes/`), as a path from the project folder (`src/routes`). */
const folderPath = (written: string): string => path.posix.normalize(written).replace(/\/+$/, '');

const NEXT_CONFIG = /^next\.config\.(js|mjs|cjs|ts|mts)$/;
const PAGES_DIR = /^(src\/)?pages\//;

/** A Next.js pages-router page: `pages/` or `src/pages/` of a folder with a next.config, or declaring `next`. */
const nextPages: FileRoutedFramework = (folder) => {
  const isNext =
    folder.names().some((name) => NEXT_CONFIG.test(name)) ||
    (folder.names().includes('package.json') &&
      (folder.declares(['next']) || folderAt(findWorkspaceRoot(folder.dir)).declares(['next'])));
  return isNext ? (inside) => PAGES_DIR.test(inside) : null;
};

/**
 * SvelteKit's files at their default locations: route files (layout resets such as `+page@.svelte` included), hooks,
 * param matchers (each file of `src/params/` in SvelteKit 2, one `src/params` module in SvelteKit 3), the service
 * worker and instrumentation.
 */
const SVELTEKIT_FILE =
  /^src\/(routes\/(.*\/)?\+(page|page\.server|layout|layout\.server|error|server)(@[^/]*)?\.(svelte|[jt]s)|(hooks(\.server|\.client)?|params|service-worker|instrumentation\.server)\.[jt]s|params\/[^/]+\.[jt]s)$/;

const svelteKitFiles: FileRoutedFramework = (folder) =>
  isSvelteKitProject(folder.dir) ? (inside) => SVELTEKIT_FILE.test(inside) : null;

/** Expo Router: every file of `src/app/`, or of `app/` when there is no `src/app/`, is a route. */
const expoRoutes: FileRoutedFramework = (folder) => {
  if (!folder.declares(['expo-router'])) return null;
  const routes = existsSync(path.join(folder.dir, 'src', 'app')) ? 'src/app/' : 'app/';
  return (inside) => inside.startsWith(routes);
};

const REACT_ROUTER_CONFIG = /^react-router\.config\.(ts|js|mjs|cjs|mts|cts)$/;
const ROUTE_MODULE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.md', '.mdx'];

/** The first `<name><extension>` file in a folder, in the extension order React Router tries. */
const routeModuleIn = (dir: string, name: string): string | undefined =>
  ROUTE_MODULE_EXTENSIONS.map((extension) => name + extension).find((file) =>
    existsSync(path.join(dir, file)),
  );

/**
 * The route modules a `flatRoutes()` call registers, read from disk as `@react-router/fs-routes` reads them: each file
 * directly in `rootDirectory` (`routes` by default, under the app folder), and each folder there's `route` module, else
 * its `index` module, unless its name starts with a dot or its path from the app folder matches an `ignoredRouteFiles`
 * glob (minimatch defaults). Paths from the project folder; null when an option is not written as a literal.
 */
function flatRouteModules(
  projectDir: string,
  app: string,
  options: ts.Expression | undefined,
): string[] | null {
  if (options !== undefined && asObject(options) === undefined) return null;
  const rootValue = objectProperty(asObject(options), 'rootDirectory');
  const ignoredValue = objectProperty(asObject(options), 'ignoredRouteFiles');
  const rootDirectory = rootValue === undefined ? 'routes' : asString(rootValue);
  if (rootDirectory === undefined || path.isAbsolute(rootDirectory)) return null;
  if (ignoredValue !== undefined && !ts.isArrayLiteralExpression(ignoredValue)) return null;
  const ignored = (ignoredValue?.elements ?? []).map((element) => asString(element));
  if (ignored.includes(undefined)) return null;
  const ignoredPatterns = ['**/.*', ...(ignored as string[])].map((glob) => new Minimatch(glob));
  const routes = path.posix.join(app, folderPath(rootDirectory));
  const modules: string[] = [];
  for (const entry of entriesOf(path.join(projectDir, routes))) {
    const entryPath = path.posix.join(routes, entry.name);
    const fromApp = path.posix.relative(app, entryPath);
    if (ignoredPatterns.some((pattern) => pattern.match(fromApp))) continue;
    if (entry.isFile()) modules.push(entryPath);
    if (entry.isDirectory()) {
      const folderDir = path.join(projectDir, entryPath);
      const module = routeModuleIn(folderDir, 'route') ?? routeModuleIn(folderDir, 'index');
      if (module !== undefined) modules.push(path.posix.join(entryPath, module));
    }
  }
  return modules;
}

function entriesOf(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Which argument of each `@react-router/dev/routes` helper is the route module's path. */
const ROUTE_FILE_ARGUMENT = new Map([
  ['route', 1],
  ['index', 0],
  ['layout', 0],
]);

/** The module paths routes.ts passes to `route(path, file)`, `index(file)` and `layout(file)`, as written. */
function routeConfigFiles(source: ts.SourceFile): string[] {
  const files: string[] = [];
  for (const [exported, local] of importedNames(source, '@react-router/dev/routes')) {
    const position = ROUTE_FILE_ARGUMENT.get(exported);
    if (position === undefined) continue;
    for (const args of callArguments(source, local)) {
      const file = asString(args[position]);
      if (file !== undefined) files.push(file);
    }
  }
  return files;
}

/**
 * React Router framework mode (a react-router.config, or `@react-router/dev` declared): the app folder's `root`,
 * `entry.client`, `entry.server` and `routes` modules, the module paths routes.ts gives the `@react-router/dev/routes`
 * helpers (from the app folder), and the route modules of its `@react-router/fs-routes` `flatRoutes()` calls. The app
 * folder is the config's literal `appDirectory`, `app` by default.
 */
const reactRouterRoutes: FileRoutedFramework = (folder) => {
  const config = folder.names().find((name) => REACT_ROUTER_CONFIG.test(name));
  if (config === undefined && !folder.declares(['@react-router/dev'])) return null;
  const appDirectory = literalSetting(
    config === undefined
      ? []
      : propertyValues(parseScript(path.join(folder.dir, config)), 'appDirectory'),
    'app',
  );
  if (appDirectory?.length !== 1) return null;
  const app = folderPath(appDirectory[0]!);
  const modules = new Set(
    ['root', 'entry.client', 'entry.server', 'routes'].flatMap((name) =>
      ROUTE_MODULE_EXTENSIONS.map((extension) => path.posix.join(app, name + extension)),
    ),
  );
  const routesFile = ROUTE_MODULE_EXTENSIONS.map((extension) =>
    path.join(folder.dir, app, `routes${extension}`),
  ).find(existsSync);
  if (routesFile !== undefined) {
    const source = parseScript(routesFile);
    for (const file of routeConfigFiles(source)) modules.add(path.posix.join(app, file));
    const flatRoutes = importedNames(source, '@react-router/fs-routes').get('flatRoutes');
    for (const args of flatRoutes === undefined ? [] : callArguments(source, flatRoutes)) {
      for (const module of flatRouteModules(folder.dir, app, args[0]) ?? []) modules.add(module);
    }
  }
  return (inside) => modules.has(inside);
};

const TANSTACK_ROUTER_PACKAGES = [
  '@tanstack/router-plugin',
  '@tanstack/router-vite-plugin',
  '@tanstack/router-cli',
  '@tanstack/react-start',
  '@tanstack/solid-start',
];

/** The values a TanStack Router project writes for an option: in its tsr.config.json and its root config files. */
function tanStackOption({ dir, names }: Folder, name: string): (string | null)[] {
  const values: (string | null)[] = [];
  try {
    const tsr = JSON.parse(readFileSync(path.join(dir, 'tsr.config.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    if (name in tsr) values.push(typeof tsr[name] === 'string' ? tsr[name] : null);
  } catch {
    /* no tsr.config.json, or one that is not JSON: the plugin options are read instead */
  }
  for (const config of names().filter((file) => CONFIG_FILE.test(file))) {
    values.push(...propertyValues(parseScript(path.join(dir, config)), name));
  }
  return values;
}

/**
 * TanStack Router file-based routing: every file under `routesDirectory` (`./src/routes` by default, else the literal
 * value its tsr.config.json or a root config file such as vite.config gives the plugin), except those in a file or
 * folder named with `routeFileIgnorePrefix` (`-` by default).
 */
const tanStackRoutes: FileRoutedFramework = (folder) => {
  if (!folder.declares(TANSTACK_ROUTER_PACKAGES)) return null;
  const directories = literalSetting(tanStackOption(folder, 'routesDirectory'), './src/routes');
  const prefixes = literalSetting(tanStackOption(folder, 'routeFileIgnorePrefix'), '-');
  if (directories === null || prefixes?.length !== 1) return null;
  const [prefix] = prefixes as [string];
  const roots = directories.map((directory) => `${folderPath(directory)}/`);
  return (inside) => {
    const root = roots.find((candidate) => inside.startsWith(candidate));
    return (
      root !== undefined &&
      !inside
        .slice(root.length)
        .split('/')
        .some((segment) => prefix !== '' && segment.startsWith(prefix))
    );
  };
};

/** Routify 2: the pages it routes, when `@roxi/routify` 2.x is declared. */
const routify2Routes: FileRoutedFramework = (folder) =>
  folder.names().includes('package.json') ? routify2Pages(folder.dir) : null;

const FILE_ROUTED_FRAMEWORKS: readonly FileRoutedFramework[] = [
  nextPages,
  svelteKitFiles,
  expoRoutes,
  reactRouterRoutes,
  tanStackRoutes,
  routify2Routes,
];

/**
 * Whether a file under `root` is one a framework loads by its location, so nothing needs to import it: a Next.js
 * pages-router page, a SvelteKit route file, hook, param matcher, service worker or instrumentation file, an Expo
 * Router route, a React Router route module, a TanStack Router route file, or a Routify 2 page, each in a project of
 * that framework.
 */
export function frameworkFilesUnder(root: string): (relativePath: string) => boolean {
  const projects = new Map<string, readonly RoutedFile[]>();
  const routedFilesOf = (dir: string): readonly RoutedFile[] => {
    let known = projects.get(dir);
    if (known === undefined) {
      const folder = folderAt(path.join(root, dir));
      known = FILE_ROUTED_FRAMEWORKS.map((framework) => framework(folder)).filter(
        (routed): routed is RoutedFile => routed !== null,
      );
      projects.set(dir, known);
    }
    return known;
  };
  return (relativePath) => {
    for (let dir = path.posix.dirname(relativePath); ; dir = path.posix.dirname(dir)) {
      const project = dir === '.' ? '' : dir;
      const inside = project === '' ? relativePath : relativePath.slice(project.length + 1);
      if (routedFilesOf(project).some((routed) => routed(inside))) return true;
      if (project === '') return false;
    }
  };
}
