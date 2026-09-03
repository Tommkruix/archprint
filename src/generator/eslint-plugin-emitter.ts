import type { DetectedPattern, PatternConfig } from '../detector/pattern-detector.js';
import { ROLE_PATTERNS } from '../scanner/role-classifier.js';

export interface ForbiddenImportSpec {
  name: string;
  roles: string[];
  markers: string[];
  message: string;
}

export function buildForbiddenImportSpecs(
  patterns: readonly { config: PatternConfig; result: DetectedPattern }[],
): ForbiddenImportSpec[] {
  const specs: ForbiddenImportSpec[] = [];
  for (const { config, result } of patterns) {
    if (result.gate.status !== 'AUTO') continue;
    const roles = config.roles.flatMap((role) =>
      (ROLE_PATTERNS.get(role) ?? []).map((pattern) => pattern.source),
    );
    if (roles.length === 0 || config.forbidden.length === 0) continue;
    specs.push({
      name: config.name,
      roles,
      markers: config.forbidden.map((marker) => marker.source),
      message: config.description,
    });
  }
  return specs;
}

export function renderEslintPluginSource(specs: readonly ForbiddenImportSpec[]): string {
  return `// archprint eslint plugin (generated). Regenerate with \`archprint generate\`; remove with \`archprint eject\`.
const SPECS = ${JSON.stringify(specs, null, 2)};

function makeRule(spec) {
  const roles = spec.roles.map((source) => new RegExp(source));
  const markers = spec.markers.map((source) => new RegExp(source));
  return {
    meta: { type: 'problem', schema: [], messages: { forbidden: spec.message } },
    create(context) {
      const file = context.filename.replace(/\\\\/g, '/');
      if (!roles.some((role) => role.test(file))) return {};
      return {
        ImportDeclaration(node) {
          if (node.importKind === 'type') return;
          if (markers.some((marker) => marker.test(node.source.value))) {
            context.report({ node, messageId: 'forbidden' });
          }
        },
      };
    },
  };
}

const rules = Object.fromEntries(SPECS.map((spec) => [spec.name, makeRule(spec)]));
export const plugin = { rules };
export default SPECS.map((spec) => ({
  files: ['**/*.{ts,tsx}'],
  plugins: { archprint: plugin },
  rules: { ['archprint/' + spec.name]: 'error' },
}));
`;
}
