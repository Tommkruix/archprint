import * as path from 'node:path';
import type { LayerBoundary } from '../detector/layer-detector.js';
import { type LayerAlias, layerRootOf, resolveImportPath } from '../detector/layer-paths.js';
import {
  SERVER_ONLY_PACKAGE,
  type ServerClientAnalysis,
} from '../detector/server-client-detector.js';
import type { PhantomDependencyAnalysis } from '../detector/phantom-dependency-detector.js';
import { hasLeadingDirective } from '../scanner/directives.js';
import { declaredPackages, packageName } from '../scanner/package-name.js';
import { firstPartyCandidates } from '../scanner/resolve-import.js';
import { ROLE_PATTERNS } from '../scanner/role-classifier.js';
import { isSkippedFolder, isSourceFileName } from '../scanner/source-paths.js';
import { LINTED_FILES } from './eslint-plugin-emitter.js';
import { layerRuleName } from './layer-emitters.js';
import { PHANTOM_DEPENDENCY_RULE } from './phantom-dependency-emitters.js';
import { SERVER_CLIENT_RULE } from './server-client-emitters.js';

/** A rule that applies to the app's files, with the files it exempts (known and allowed exceptions). */
export interface AppRule {
  name: string;
  message: string;
  ignore: string[];
}

export interface LayerRuleSpec extends AppRule {
  from: string;
  to: string;
}

export interface PhantomRuleSpec extends AppRule {
  /** The package.json files read for declared dependencies when ESLint loads the config. */
  packageJsons: string[];
  workspacePackages: string[];
}

export interface ServerClientRuleSpec extends AppRule {
  serverModules: string[];
}

/** The app the rules enforce: where it is, its import aliases, and the gitignored paths the scan left out. */
export interface AppScope {
  appDir: string;
  aliases: LayerAlias[];
  ignored: string[];
}

export interface EslintAppRules extends AppScope {
  layers: LayerRuleSpec[];
  phantom: PhantomRuleSpec | null;
  serverClient: ServerClientRuleSpec | null;
}

type AllowedFor = (ruleId: string) => readonly string[];

const exempting = (name: string, files: readonly string[], allowedFor: AllowedFor): string[] =>
  [...new Set([...files, ...allowedFor(name)])].sort();

export const layerRuleSpecs = (
  boundaries: readonly LayerBoundary[],
  allowedFor: AllowedFor,
): LayerRuleSpec[] =>
  boundaries.map((boundary) => {
    const name = layerRuleName(boundary);
    return {
      name,
      from: boundary.from,
      to: boundary.to,
      message: boundary.description,
      ignore: exempting(
        name,
        boundary.violations.map((violation) => violation.file),
        allowedFor,
      ),
    };
  });

export const phantomRuleSpec = (
  analysis: PhantomDependencyAnalysis,
  packageJsons: readonly string[],
  workspacePackages: readonly string[],
  allowedFor: AllowedFor,
): PhantomRuleSpec => ({
  name: PHANTOM_DEPENDENCY_RULE,
  message: 'Import only packages declared in package.json (archprint: the code already does).',
  ignore: exempting(
    PHANTOM_DEPENDENCY_RULE,
    analysis.violations.map((violation) => violation.file),
    allowedFor,
  ),
  packageJsons: [...packageJsons],
  workspacePackages: [...workspacePackages],
});

export const serverClientRuleSpec = (
  analysis: ServerClientAnalysis,
  allowedFor: AllowedFor,
): ServerClientRuleSpec => ({
  name: SERVER_CLIENT_RULE,
  message: `A "use client" module must not import a server-only module (archprint: the code already does not).`,
  ignore: exempting(
    SERVER_CLIENT_RULE,
    analysis.violations.map((violation) => violation.file),
    allowedFor,
  ),
  serverModules: [...analysis.serverModules],
});

export const hasAppRules = (rules: EslintAppRules): boolean =>
  rules.layers.length > 0 || rules.phantom !== null || rules.serverClient !== null;

const APP_RUNTIME = `function realPathOf(filename) {
  try {
    return realpathSync(filename);
  } catch {
    try {
      return join(realpathSync(dirname(filename)), basename(filename));
    } catch {
      return filename;
    }
  }
}

function isValueImport(node) {
  return (
    node.importKind !== 'type' &&
    (node.specifiers.length === 0 ||
      node.specifiers.some((specifier) => specifier.type !== 'ImportSpecifier' || specifier.importKind !== 'type'))
  );
}

function isScanned(file) {
  const segments = file.split('/');
  return (
    isSourceFileName(segments.pop()) &&
    !segments.some(isSkippedFolder) &&
    !APP.ignored.some((path) => file === path || file.startsWith(path + '/'))
  );
}

function appRelativePath(filename) {
  const relativePath = relative(APP_DIR, realPathOf(filename));
  return relativePath.startsWith('..') || isAbsolute(relativePath)
    ? null
    : relativePath.split(sep).join('/');
}

function importVisitors(check) {
  return {
    ImportDeclaration(node) {
      if (node.parent.type === 'Program' && isValueImport(node)) check(node, node.source.value);
    },
    ImportExpression(node) {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
        check(node, node.source.value);
      }
    },
  };
}

function appRule(spec, create) {
  return {
    meta: { type: 'problem', schema: [], messages: { forbidden: spec.message } },
    create(context) {
      const file = appRelativePath(context.physicalFilename);
      if (file === null || !isScanned(file)) return {};
      if (APP_TESTS.some((test) => test.test(file)) || spec.ignore.includes(file)) return {};
      return create(context, file);
    },
  };
}`;

const LAYER_RUNTIME = `function makeLayerRule(spec) {
  return appRule(spec, (context, file) =>
    layerRootOf(file)?.layer !== spec.from
      ? {}
      : importVisitors((node, specifier) => {
          const target = resolveImportPath(file, specifier, APP.aliases);
          if (target !== null && layerRootOf(target)?.layer === spec.to) {
            context.report({ node, messageId: 'forbidden' });
          }
        }),
  );
}`;

const PHANTOM_RUNTIME = `const PHANTOM_DECLARED = new Set([
  ...PHANTOM.workspacePackages,
  ...PHANTOM.packageJsons.flatMap((file) => {
    try {
      return declaredPackages(readFileSync(resolve(CONFIG_DIR, file), 'utf8'));
    } catch {
      return [];
    }
  }),
]);
const PHANTOM_ALIASES = APP.aliases.map((alias) => alias.prefix);
const PHANTOM_BUILTINS = new Set(builtinModules);

function makePhantomRule(spec) {
  return appRule(spec, (context) =>
    importVisitors((node, specifier) => {
      const name = packageName(specifier, PHANTOM_ALIASES, PHANTOM_BUILTINS);
      if (name !== null && !PHANTOM_DECLARED.has(name)) context.report({ node, messageId: 'forbidden' });
    }),
  );
}`;

const SERVER_CLIENT_RUNTIME = `const SERVER_MODULES = new Set(SERVER_CLIENT.serverModules);

function firstPartyTarget(file, specifier) {
  const base = resolveImportPath(file, specifier, APP.aliases);
  if (base === null) return null;
  return firstPartyCandidates(base).find((candidate) => existsSync(join(APP_DIR, candidate))) ?? null;
}

function makeServerClientRule(spec) {
  return appRule(spec, (context, file) =>
    !hasLeadingDirective(context.sourceCode.text, 'use client')
      ? {}
      : importVisitors((node, specifier) => {
          if (specifier === ${JSON.stringify(SERVER_ONLY_PACKAGE)} || SERVER_MODULES.has(firstPartyTarget(file, specifier))) {
            context.report({ node, messageId: 'forbidden' });
          }
        }),
  );
}`;

export interface RenderedAppRules {
  imports: string;
  source: string;
  rules: string;
  config: string;
}

/** The pieces of the generated ESLint file that enforce app-scoped rules, located relative to that file. */
export function renderEslintAppRules(rules: EslintAppRules, outDir: string): RenderedAppRules {
  const relativeToConfig = (file: string): string =>
    path.relative(outDir, file).split(path.sep).join('/') || '.';
  const app = {
    app: relativeToConfig(rules.appDir),
    aliases: rules.aliases,
    ignored: rules.ignored,
    tests: (ROLE_PATTERNS.get('TEST') ?? []).map((pattern) => pattern.source),
  };
  const { layers, phantom, serverClient } = rules;
  const json = (value: unknown): string => JSON.stringify(value, null, 2);
  const specs = [
    ...layers.map((spec) => ({ spec, make: 'makeLayerRule' })),
    ...(phantom === null ? [] : [{ spec: phantom, make: 'makePhantomRule' }]),
    ...(serverClient === null ? [] : [{ spec: serverClient, make: 'makeServerClientRule' }]),
  ];
  const source = [
    `const APP = ${json(app)};`,
    `const APP_RULES = ${json(specs.map(({ spec, make }) => ({ ...spec, make })))};`,
    'const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));',
    'const APP_DIR = realPathOf(resolve(CONFIG_DIR, APP.app));',
    'const APP_TESTS = APP.tests.map((source) => new RegExp(source));',
    isSkippedFolder.toString(),
    isSourceFileName.toString(),
    resolveImportPath.toString(),
    APP_RUNTIME,
    ...(layers.length === 0 ? [] : [layerRootOf.toString(), LAYER_RUNTIME]),
    ...(phantom === null
      ? []
      : [
          `const PHANTOM = ${json({ packageJsons: phantom.packageJsons.map(relativeToConfig), workspacePackages: phantom.workspacePackages })};`,
          packageName.toString(),
          declaredPackages.toString(),
          PHANTOM_RUNTIME,
        ]),
    ...(serverClient === null
      ? []
      : [
          `const SERVER_CLIENT = ${json({ serverModules: serverClient.serverModules })};`,
          hasLeadingDirective.toString(),
          firstPartyCandidates.toString(),
          SERVER_CLIENT_RUNTIME,
        ]),
    `const APP_MAKERS = { ${[...new Set(specs.map(({ make }) => make))].join(', ')} };`,
  ].join('\n\n');
  return {
    imports: [
      "import { existsSync, readFileSync, realpathSync } from 'node:fs';",
      "import { builtinModules } from 'node:module';",
      "import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
    ].join('\n'),
    source,
    rules: 'APP_RULES.map((spec) => [spec.name, APP_MAKERS[spec.make](spec)])',
    config: `{
  files: ${LINTED_FILES},
  plugins: { archprint: plugin },
  rules: Object.fromEntries(APP_RULES.map((spec) => ['archprint/' + spec.name, 'error'])),
}`,
  };
}
