import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import {
  asObject,
  asString,
  callArguments,
  configObjects,
  defaultImportName,
  objectProperty,
  parseScript,
} from '../scanner/config-literals.js';
import { CONFIG_FILE } from './reference-graph.js';

/** Routify 2's options that decide which files it routes: a value, absent, or null when written as code. */
interface Settings {
  pages?: string | null;
  extensions?: string[] | null;
  ignore?: string | null;
}

const DEFAULTS = { pages: 'src/pages', extensions: ['html', 'svelte', 'md', 'svx'], ignore: '' };
const ROLLUP_PLUGIN = '@roxi/routify/plugins/rollup';
/** The underscored files Routify loads: layouts, resets, folder modules and fallbacks. */
const LOADED_UNDERSCORED = new Set(['_layout', '_folder', '_module', '_reset', '_fallback']);

const isMajorTwo = (range: unknown): boolean =>
  typeof range === 'string' && /^\s*[~^]?2(\.|$|\s)/.test(range);

const extensionList = (value: unknown): string[] | null => {
  if (typeof value === 'string') return value.split(',');
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
};

/** The settings in a JSON object, such as package.json's `routify` key. */
function jsonSettings(value: unknown): Settings {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object') return { pages: null };
  const record = value as Record<string, unknown>;
  const settings: Settings = {};
  if ('pages' in record) settings.pages = typeof record.pages === 'string' ? record.pages : null;
  if ('extensions' in record) settings.extensions = extensionList(record.extensions);
  if ('ignore' in record)
    settings.ignore = typeof record.ignore === 'string' ? record.ignore : null;
  return settings;
}

/** The settings an object literal writes, such as routify.config.js's export or the rollup plugin's options. */
function literalSettings(object: ts.ObjectLiteralExpression | undefined): Settings {
  const settings: Settings = {};
  const read = (name: keyof Settings): ts.Expression | undefined => objectProperty(object, name);
  const pages = read('pages');
  if (pages !== undefined) settings.pages = asString(pages) ?? null;
  const ignore = read('ignore');
  if (ignore !== undefined) settings.ignore = asString(ignore) ?? null;
  const extensions = read('extensions');
  if (extensions !== undefined) {
    const items = ts.isArrayLiteralExpression(extensions)
      ? extensions.elements.map((element) => asString(element))
      : [asString(extensions)];
    settings.extensions = items.includes(undefined)
      ? null
      : extensionList(ts.isArrayLiteralExpression(extensions) ? items : items[0]);
  }
  return settings;
}

const FLAGS: Record<string, keyof Settings> = {
  '-p': 'pages',
  '--pages': 'pages',
  '-e': 'extensions',
  '--extensions': 'extensions',
  '-i': 'ignore',
  '--ignore': 'ignore',
};

/** The settings each `routify` command in package.json `scripts` passes as flags. */
function scriptSettings(scripts: unknown): Settings[] {
  if (scripts === null || typeof scripts !== 'object') return [];
  return Object.values(scripts)
    .filter((command): command is string => typeof command === 'string')
    .flatMap((command) => command.split(/&&|\|\||[;|]/))
    .flatMap((command) => {
      const words = command.trim().split(/\s+/);
      const start = words.findIndex((word) => word === 'routify' || word.endsWith('/routify'));
      if (start === -1) return [];
      const settings: Settings = {};
      for (let index = start + 1; index < words.length; index++) {
        const [flag, inline] = words[index]!.split('=', 2) as [string, string | undefined];
        const option = FLAGS[flag];
        if (option === undefined) continue;
        const value = (inline ?? words[++index] ?? '').replace(/^['"]|['"]$/g, '');
        if (option === 'extensions') settings.extensions = value.split(',');
        else settings[option] = value;
      }
      return [settings];
    });
}

/** The options each call of Routify's rollup plugin passes, in the project's root config files. */
function pluginSettings(dir: string): Settings[] {
  return readdirSync(dir)
    .filter((name) => CONFIG_FILE.test(name))
    .flatMap((name) => {
      const source = parseScript(path.join(dir, name));
      const plugin = defaultImportName(source, ROLLUP_PLUGIN);
      if (plugin === undefined) return [];
      return callArguments(source, plugin).map((args) =>
        args[0] === undefined
          ? {}
          : asObject(args[0]) === undefined
            ? { pages: null }
            : literalSettings(asObject(args[0])),
      );
    });
}

/** Routify's own settings file, routify.config.js: its exported object's literal settings. */
function configFileSettings(dir: string): Settings {
  const file = path.join(dir, 'routify.config.js');
  if (!existsSync(file)) return {};
  const [config, ...others] = configObjects(parseScript(file));
  return config === undefined || others.length > 0 ? { pages: null } : literalSettings(config);
}

const definedOnly = (settings: Settings): Settings =>
  Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));

/**
 * Routify 2 (`@roxi/routify` 2.x declared): the files it routes, as its file tree generator reads `pages` (`src/pages`
 * by default, `imports/ui/pages` in a Meteor app): files with one of its `extensions`, outside any folder whose name
 * starts with `_`, and not named with `_` unless a layout, reset, folder module or fallback. Settings are read in
 * Routify's precedence (package.json `routify`, routify.config.js, then each `routify` command's flags and each rollup
 * plugin call's options) and only as literals; a setting written as code, an `ignore` glob or a `ROUTIFY_` variable in
 * .env makes the rule not apply.
 */
export function routify2Pages(dir: string): ((inside: string) => boolean) | null {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
  const ranges = ['dependencies', 'devDependencies'].map(
    (field) => (manifest[field] as Record<string, unknown> | undefined)?.['@roxi/routify'],
  );
  if (!ranges.some(isMajorTwo)) return null;
  try {
    if (/^\s*(export\s+)?ROUTIFY_/m.test(readFileSync(path.join(dir, '.env'), 'utf8'))) return null;
  } catch {
    /* no .env */
  }
  const meteor =
    (manifest.dependencies as Record<string, unknown> | undefined)?.['meteor-node-stubs'] !==
    undefined;
  const base = {
    ...DEFAULTS,
    ...(meteor ? { pages: 'imports/ui/pages' } : {}),
    ...definedOnly(jsonSettings(manifest.routify)),
    ...definedOnly(configFileSettings(dir)),
  };
  const runs = [...scriptSettings(manifest.scripts), ...pluginSettings(dir)];
  const effective = (runs.length === 0 ? [{}] : runs).map((run) => ({
    ...base,
    ...definedOnly(run),
  }));
  if (effective.some((run) => run.pages === null || run.extensions === null || run.ignore !== '')) {
    return null;
  }
  const routed = effective.map((run) => ({
    root: `${path.posix.normalize(run.pages as string).replace(/\/+$/, '')}/`,
    extensions: run.extensions as string[],
  }));
  return (inside) =>
    routed.some(({ root, extensions }) => {
      if (!inside.startsWith(root)) return false;
      const segments = inside.slice(root.length).split('/');
      const file = segments.pop()!;
      if (segments.some((segment) => segment.startsWith('_'))) return false;
      const extension = extensions.find((candidate) => file.endsWith(`.${candidate}`));
      if (extension === undefined) return false;
      const name = file.slice(0, -(extension.length + 1));
      return !name.startsWith('_') || LOADED_UNDERSCORED.has(name);
    });
}
