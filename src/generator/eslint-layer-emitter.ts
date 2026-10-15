import * as path from 'node:path';
import type { LayerBoundary } from '../detector/layer-detector.js';
import { type LayerAlias, layerRootOf, resolveImportPath } from '../detector/layer-paths.js';
import { ROLE_PATTERNS } from '../scanner/role-classifier.js';
import { isSkippedFolder, isSourceFileName } from '../scanner/source-paths.js';
import { LINTED_FILES } from './eslint-plugin-emitter.js';
import { layerRuleName } from './layer-emitters.js';

export interface EslintLayerRule {
  name: string;
  from: string;
  to: string;
  message: string;
  ignore: string[];
}

/** The app the rules enforce: where it is, its import aliases, and the gitignored paths the scan left out. */
export interface LayerApp {
  appDir: string;
  aliases: LayerAlias[];
  ignored: string[];
}

export interface EslintLayers extends LayerApp {
  rules: EslintLayerRule[];
}

/** The given layer boundaries as ESLint rules, each exempting its known and allowed exceptions. */
export function buildEslintLayers(
  boundaries: readonly LayerBoundary[],
  app: LayerApp,
  allowedFor: (ruleId: string) => readonly string[],
): EslintLayers | null {
  const rules = boundaries.map((boundary) => {
    const name = layerRuleName(boundary);
    const exceptions = [
      ...boundary.violations.map((violation) => violation.file),
      ...allowedFor(name),
    ];
    return {
      name,
      from: boundary.from,
      to: boundary.to,
      message: boundary.description,
      ignore: [...new Set(exceptions)].sort(),
    };
  });
  return rules.length === 0 ? null : { ...app, rules };
}

const LAYER_RULE_FUNCTIONS = `function isValueImport(node) {
  return (
    node.importKind !== 'type' &&
    (node.specifiers.length === 0 ||
      node.specifiers.some((specifier) => specifier.type !== 'ImportSpecifier' || specifier.importKind !== 'type'))
  );
}

function realPathOf(filename) {
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

function isScanned(file) {
  const segments = file.split('/');
  return (
    isSourceFileName(segments.pop()) &&
    !segments.some(isSkippedFolder) &&
    !LAYERS.ignored.some((path) => file === path || file.startsWith(path + '/'))
  );
}

function appRelativePath(filename) {
  const relativePath = relative(LAYER_APP_DIR, realPathOf(filename));
  return relativePath.startsWith('..') || isAbsolute(relativePath)
    ? null
    : relativePath.split(sep).join('/');
}

function makeLayerRule(spec) {
  return {
    meta: { type: 'problem', schema: [], messages: { forbidden: spec.message } },
    create(context) {
      const file = appRelativePath(context.physicalFilename);
      if (file === null || !isScanned(file)) return {};
      if (LAYER_TESTS.some((test) => test.test(file)) || spec.ignore.includes(file)) return {};
      if (layerRootOf(file)?.layer !== spec.from) return {};
      const check = (node, specifier) => {
        const target = resolveImportPath(file, specifier, LAYERS.aliases);
        if (target !== null && layerRootOf(target)?.layer === spec.to) {
          context.report({ node, messageId: 'forbidden' });
        }
      };
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
    },
  };
}`;

export interface RenderedEslintLayers {
  imports: string;
  source: string;
  rules: string;
  config: string;
}

/** The pieces of the generated ESLint file that enforce layer boundaries, located relative to that file. */
export function renderEslintLayers(layers: EslintLayers, outDir: string): RenderedEslintLayers {
  const data = {
    app: path.relative(outDir, layers.appDir).split(path.sep).join('/') || '.',
    aliases: layers.aliases,
    ignored: layers.ignored,
    tests: (ROLE_PATTERNS.get('TEST') ?? []).map((pattern) => pattern.source),
    rules: layers.rules,
  };
  return {
    imports: [
      "import { realpathSync } from 'node:fs';",
      "import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
    ].join('\n'),
    source: [
      `const LAYERS = ${JSON.stringify(data, null, 2)};`,
      'const LAYER_APP_DIR = realPathOf(resolve(dirname(fileURLToPath(import.meta.url)), LAYERS.app));',
      'const LAYER_TESTS = LAYERS.tests.map((source) => new RegExp(source));',
      layerRootOf.toString(),
      resolveImportPath.toString(),
      isSkippedFolder.toString(),
      isSourceFileName.toString(),
      LAYER_RULE_FUNCTIONS,
    ].join('\n\n'),
    rules: 'LAYERS.rules.map((spec) => [spec.name, makeLayerRule(spec)])',
    config: `{
  files: ${LINTED_FILES},
  plugins: { archprint: plugin },
  rules: Object.fromEntries(LAYERS.rules.map((spec) => ['archprint/' + spec.name, 'error'])),
}`,
  };
}
