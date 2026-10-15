import type { RenderedEslintLayers } from './eslint-layer-emitter.js';
import {
  type ForbiddenImportSpec,
  MAKE_RULE_FUNCTION,
  PLUGIN_CONFIGS,
} from './eslint-plugin-emitter.js';

export function renderEslintPreset(
  specs: readonly ForbiddenImportSpec[],
  blocks: readonly unknown[],
  options: { ignore?: string; adoptPath?: string; layers?: RenderedEslintLayers } = {},
): string {
  const ignore = options.ignore ?? '**/.archprint/**';
  const adoptPath = options.adoptPath ?? './.archprint/eslint.mjs';
  const { layers } = options;
  const header = `// archprint eslint rules (generated, self-contained). Regenerate with \`archprint generate\`; remove with \`archprint eject\`.
// Adopt it in one line:  import archprint from '${adoptPath}';  export default [...archprint];
${layers ? `${layers.imports}\n` : ''}`;
  const rules = layers
    ? `Object.fromEntries([
  ...SPECS.map((spec) => [spec.name, makeRule(spec)]),
  ...${layers.rules},
])`
    : 'Object.fromEntries(SPECS.map((spec) => [spec.name, makeRule(spec)]))';
  const configs = layers ? `[...${PLUGIN_CONFIGS}, ${layers.config}]` : PLUGIN_CONFIGS;
  return `${header}const SPECS = ${JSON.stringify(specs, null, 2)};
const BLOCKS = ${JSON.stringify(blocks, null, 2)};

${MAKE_RULE_FUNCTION}
${layers ? `\n${layers.source}\n` : ''}
const rules = ${rules};
const plugin = { rules };
const pluginConfigs = ${configs};

export default [{ ignores: ['${ignore}'] }, ...BLOCKS, ...pluginConfigs];
`;
}
