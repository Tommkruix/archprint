import {
  type ForbiddenImportSpec,
  MAKE_RULE_FUNCTION,
  PLUGIN_CONFIGS,
} from './eslint-plugin-emitter.js';

// A shareable, self-contained ESLint flat-config preset. Unlike the wiring aggregator (which reads sibling
// files at runtime), this inlines every forbidden-import spec and every eslint block into one portable module,
// so a teammate or another repository can adopt the inferred rules in one line with only eslint installed.
export function renderEslintPreset(
  specs: readonly ForbiddenImportSpec[],
  blocks: readonly unknown[],
): string {
  return `// archprint eslint preset (generated, self-contained). Share or publish this one file; it needs only eslint.
// Adopt it in one line:  import archprint from './eslint-preset.archprint.mjs';  export default [...archprint];
const SPECS = ${JSON.stringify(specs, null, 2)};
const BLOCKS = ${JSON.stringify(blocks, null, 2)};

${MAKE_RULE_FUNCTION}

const rules = Object.fromEntries(SPECS.map((spec) => [spec.name, makeRule(spec)]));
const plugin = { rules };
const pluginConfigs = ${PLUGIN_CONFIGS};

export default [...BLOCKS, ...pluginConfigs];
`;
}
