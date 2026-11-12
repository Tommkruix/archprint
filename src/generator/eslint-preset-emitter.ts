import { matchingSubpath } from '../detector/layer-paths.js';
import type { RenderedAppRules } from './eslint-app-emitter.js';
import {
  type EslintFamilyRule,
  FAMILY_CONFIGS,
  MAKE_FAMILY_RULE_FUNCTION,
} from './eslint-family-rules.js';
import {
  type ForbiddenImportSpec,
  IMPORT_RUNTIME,
  MAKE_RULE_FUNCTION,
  PLUGIN_CONFIGS,
} from './eslint-plugin-emitter.js';

export function renderEslintPreset(
  specs: readonly ForbiddenImportSpec[],
  families: readonly EslintFamilyRule[],
  options: { ignore?: string; adoptPath?: string; app?: RenderedAppRules } = {},
): string {
  const ignore = options.ignore ?? '**/.archprint/**';
  const adoptPath = options.adoptPath ?? './.archprint/eslint.mjs';
  const { app } = options;
  const header = `// archprint eslint rules (generated, self-contained). Regenerate with \`archprint generate\`; remove with \`archprint eject\`.
// Adopt it in one line:  import archprint from '${adoptPath}';  export default [...archprint];
${app ? `${app.imports}\n` : ''}`;
  const rules = `Object.fromEntries([
  ...SPECS.map((spec) => [spec.name, makeRule(spec)]),
  ...FAMILY_RULES.map((spec) => [spec.name, makeFamilyRule(spec)]),${app ? `\n  ...${app.rules},` : ''}
])`;
  const configs = `[...${PLUGIN_CONFIGS}, ...${FAMILY_CONFIGS}${app ? `, ${app.config}` : ''}]`;
  return `${header}const SPECS = ${JSON.stringify(specs, null, 2)};
const FAMILY_RULES = ${JSON.stringify(families, null, 2)};

${MAKE_RULE_FUNCTION}

${IMPORT_RUNTIME}

${MAKE_FAMILY_RULE_FUNCTION}

${matchingSubpath.toString()}
${app ? `\n${app.source}\n` : ''}
const rules = ${rules};
const plugin = { rules };
const pluginConfigs = ${configs};

export default [{ ignores: ['${ignore}'] }, ...pluginConfigs];
`;
}
