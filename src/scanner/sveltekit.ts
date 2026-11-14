import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { declaredPackages } from './package-name.js';
import { findWorkspaceRoot } from './workspace-packages.js';

const CONFIG_NAMES = [
  'svelte.config.js',
  'svelte.config.mjs',
  'svelte.config.cjs',
  'svelte.config.ts',
];
const VITE_CONFIG_NAMES = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map(
  (ext) => `vite.config.${ext}`,
);
const KIT_VITE_PLUGIN = '@sveltejs/kit/vite';
const DEFAULT_LIB = 'src/lib';

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);

function declaresKit(dir: string): boolean {
  try {
    return declaredPackages(readFileSync(path.join(dir, 'package.json'), 'utf8')).includes(
      '@sveltejs/kit',
    );
  } catch {
    return false;
  }
}

const declaresKitFor = (dir: string): boolean =>
  declaresKit(dir) || declaresKit(findWorkspaceRoot(dir));

/** The svelte.config of a SvelteKit project folder: one whose project or workspace root declares `@sveltejs/kit`. */
function svelteKitConfig(dir: string): string | undefined {
  const configPath = CONFIG_NAMES.map((name) => path.join(dir, name)).find(existsSync);
  return configPath !== undefined && declaresKitFor(dir) ? configPath : undefined;
}

/**
 * Whether a folder's Vite config imports SvelteKit's plugin, which is where SvelteKit 3 takes its options, and the
 * folder or its workspace root declares `@sveltejs/kit`.
 */
function loadsKitVitePlugin(dir: string): boolean {
  const configPath = VITE_CONFIG_NAMES.map((name) => path.join(dir, name)).find(existsSync);
  return (
    configPath !== undefined &&
    declaresKitFor(dir) &&
    parse(configPath).statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === KIT_VITE_PLUGIN,
    )
  );
}

const propertyName = (property: ts.ObjectLiteralElementLike): string | undefined =>
  ts.isPropertyAssignment(property) &&
  (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : undefined;

function objectProperty(
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): ts.Expression | undefined {
  const found = object?.properties.find((property) => propertyName(property) === name);
  return found !== undefined && ts.isPropertyAssignment(found) ? found.initializer : undefined;
}

const asObject = (node: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined =>
  node !== undefined && ts.isObjectLiteralExpression(node) ? node : undefined;

const asString = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

/** The `kit: { ... }` object literal of a svelte.config, wherever the config object is written. */
function kitObject(source: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  let kit: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (kit !== undefined) return;
    if (ts.isPropertyAssignment(node) && propertyName(node) === 'kit') {
      kit = asObject(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return kit;
}

/** `kit.files.lib`: `src/lib` when the config leaves it unset, undefined when it sets it to a value not written as text. */
function libFolder(kit: ts.ObjectLiteralExpression | undefined): string | undefined {
  const files = objectProperty(kit, 'files');
  if (files === undefined) return DEFAULT_LIB;
  if (!ts.isObjectLiteralExpression(files)) return undefined;
  const lib = objectProperty(files, 'lib');
  return lib === undefined ? DEFAULT_LIB : asString(lib);
}

/**
 * SvelteKit's import aliases for a project folder, read from its svelte.config without running it: `$lib`
 * (`kit.files.lib`, `src/lib` by default, none when it is computed) and the string entries of `kit.alias`. SvelteKit
 * writes them into a generated `.svelte-kit/tsconfig.json`, which a fresh checkout does not have. A project with no
 * svelte.config, found by its Vite config, gets `$lib` as `src/lib`: the default, and the only place SvelteKit 3
 * allows. Empty outside a SvelteKit project.
 */
export function svelteKitAliases(dir: string): Record<string, string> {
  const configPath = svelteKitConfig(dir);
  if (configPath === undefined) {
    return loadsKitVitePlugin(dir) ? { $lib: path.resolve(dir, DEFAULT_LIB) } : {};
  }
  const kit = kitObject(parse(configPath));
  const lib = libFolder(kit);
  const aliases: Record<string, string> = lib === undefined ? {} : { $lib: path.resolve(dir, lib) };
  for (const property of asObject(objectProperty(kit, 'alias'))?.properties ?? []) {
    const name = propertyName(property);
    const target = ts.isPropertyAssignment(property) ? asString(property.initializer) : undefined;
    if (name === undefined || target === undefined) continue;
    aliases[name.replace(/\/\*$/, '')] = path.resolve(dir, target.replace(/\/\*$/, ''));
  }
  return aliases;
}

/**
 * Whether a folder is a SvelteKit project: it or its workspace root declares `@sveltejs/kit`, and it holds a
 * svelte.config or a Vite config that imports `@sveltejs/kit/vite` (a SvelteKit 3 project has no svelte.config).
 */
export const isSvelteKitProject = (dir: string): boolean =>
  svelteKitConfig(dir) !== undefined || loadsKitVitePlugin(dir);

/** SvelteKit's virtual modules (`$app/...`, `$env/...`, `$service-worker`), which no package provides. */
export const svelteKitModules = (dir: string): string[] =>
  isSvelteKitProject(dir) ? ['$app', '$env', '$service-worker'] : [];
