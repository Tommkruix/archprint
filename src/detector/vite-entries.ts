import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { pathFromFolder } from '../scanner/computed-paths.js';
import {
  asObject,
  asString,
  configObjects,
  objectProperty,
  parseScript,
} from '../scanner/config-literals.js';
import { directoriesUnder } from '../scanner/directory-walk.js';
import { firstPartyCandidates } from '../scanner/resolve-import.js';
import { viteConfigIn } from '../scanner/vite-config.js';

const COMMENT = /<!--[\s\S]*?-->/g;
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const PATH_SPECIFIER = /^\.{0,2}\//;

const isFile = (file: string): boolean =>
  statSync(file, { throwIfNoEntry: false })?.isFile() === true;

const sourceFileAt = (base: string): string | undefined => firstPartyCandidates(base).find(isFile);

/** A tag's attributes, names lowercased as HTML parsers do, the first of a repeated name kept. */
function attributes(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, double, single, bare] of text.matchAll(ATTRIBUTE)) {
    const key = name!.toLowerCase();
    if (!found.has(key)) found.set(key, double ?? single ?? bare ?? '');
  }
  return found;
}

interface ViteProject {
  root: string;
  publicDir: string | null;
}

/** The source file a page's script URL names: `/` from the Vite root unless `publicDir` holds it, else from the page. */
function scriptTarget(url: string, page: string, project: ViteProject): string | undefined {
  const written = url.split(/[?#]/, 1)[0]!;
  if (written === '' || EXTERNAL.test(written)) return undefined;
  if (!written.startsWith('/')) return sourceFileAt(path.resolve(path.dirname(page), written));
  if (project.publicDir !== null && isFile(path.join(project.publicDir, written))) return undefined;
  return sourceFileAt(path.join(project.root, written));
}

/** The files a page loads as modules: each module script's `src`, and the path imports of each inline module script. */
function pageEntries(page: string, project: ViteProject): string[] {
  let html: string;
  try {
    html = readFileSync(page, 'utf8');
  } catch {
    return [];
  }
  const urls: string[] = [];
  for (const [, attributeText, body] of html.replace(COMMENT, '').matchAll(SCRIPT)) {
    const tag = attributes(attributeText!);
    if (tag.get('type') !== 'module' || tag.has('vite-ignore')) continue;
    const src = tag.get('src');
    if (src !== undefined) urls.push(src);
    else {
      urls.push(
        ...ts
          .preProcessFile(body!, true, true)
          .importedFiles.map((file) => file.fileName)
          .filter((specifier) => PATH_SPECIFIER.test(specifier)),
      );
    }
  }
  return urls.flatMap((url) => scriptTarget(url, page, project) ?? []);
}

/** A config value's paths: a string, each element of an array, each value of an object. */
function pathNodes(node: ts.Expression | undefined): ts.Expression[] {
  if (node === undefined) return [];
  if (ts.isArrayLiteralExpression(node)) return [...node.elements];
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((property) =>
      ts.isPropertyAssignment(property) ? [property.initializer] : [],
    );
  }
  return [node];
}

/** Where a config's path value points: a literal from `base`, a path built from the config's folder from there. */
function configPath(node: ts.Expression, source: ts.SourceFile, base: string): string | null {
  const literal = asString(node);
  if (literal !== undefined) return path.resolve(base, literal);
  const fromConfig = pathFromFolder(node, source);
  return fromConfig === null ? null : path.resolve(path.dirname(source.fileName), fromConfig);
}

/** A config's `publicDir`: none when `false`, Vite's default `public` when absent or not written as a path. */
function publicDirOf(
  node: ts.Expression | undefined,
  source: ts.SourceFile,
  root: string,
): string | null {
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return null;
  return (node === undefined ? null : configPath(node, source, root)) ?? path.join(root, 'public');
}

/**
 * The files a Vite config's pages load as modules: `<root>/index.html` (served by the dev server and built by default)
 * and each HTML file in `build.rollupOptions.input` or `build.rolldownOptions.input`. Other inputs are already
 * references, as a config's file paths are. A config whose `root` is not written as a path counts nothing.
 */
function viteEntries(configFile: string): string[] {
  let source: ts.SourceFile;
  try {
    source = parseScript(configFile);
  } catch {
    return [];
  }
  const configDir = path.dirname(configFile);
  return configObjects(source).flatMap((config) => {
    const rootNode = objectProperty(config, 'root');
    const root = rootNode === undefined ? configDir : configPath(rootNode, source, configDir);
    if (root === null) return [];
    const project: ViteProject = {
      root,
      publicDir: publicDirOf(objectProperty(config, 'publicDir'), source, root),
    };
    const build = asObject(objectProperty(config, 'build'));
    const inputs = ['rollupOptions', 'rolldownOptions']
      .flatMap((options) =>
        pathNodes(objectProperty(asObject(objectProperty(build, options)), 'input')),
      )
      .flatMap((node) => configPath(node, source, root) ?? []);
    const pages = new Set([
      path.join(root, 'index.html'),
      ...inputs.filter((file) => file.endsWith('.html')),
    ]);
    return [...pages].flatMap((page) => pageEntries(page, project));
  });
}

/** The files under `root` a Vite project's pages load as modules, as paths from `root`. */
export function viteEntriesUnder(root: string): Set<string> {
  const entries = new Set<string>();
  const configs = directoriesUnder(root, (dir) => viteConfigIn(dir) !== undefined).flatMap(
    (dir) => viteConfigIn(dir) ?? [],
  );
  for (const config of configs) {
    for (const file of viteEntries(config)) {
      entries.add(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  return entries;
}
