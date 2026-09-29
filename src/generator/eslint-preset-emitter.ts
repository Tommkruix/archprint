import {
  type ForbiddenImportSpec,
  MAKE_RULE_FUNCTION,
  PLUGIN_CONFIGS,
} from './eslint-plugin-emitter.js';

export function renderEslintPreset(
  specs: readonly ForbiddenImportSpec[],
  blocks: readonly unknown[],
  options: { ignore?: string; adoptPath?: string } = {},
): string {
  const ignore = options.ignore ?? '**/.archprint/**';
  const adoptPath = options.adoptPath ?? './.archprint/eslint.mjs';
  return `// archprint eslint rules (generated, self-contained). Regenerate with \`archprint generate\`; remove with \`archprint eject\`.
// Adopt it in one line:  import archprint from '${adoptPath}';  export default [...archprint];
const SPECS = ${JSON.stringify(specs, null, 2)};
const BLOCKS = ${JSON.stringify(blocks, null, 2)};

${MAKE_RULE_FUNCTION}

const rules = Object.fromEntries(SPECS.map((spec) => [spec.name, makeRule(spec)]));
const plugin = { rules };
const pluginConfigs = ${PLUGIN_CONFIGS};

export default [{ ignores: ['${ignore}'] }, ...BLOCKS, ...pluginConfigs];
`;
}
