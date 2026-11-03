import { LINTED_FILES } from './eslint-plugin-emitter.js';

/** What a family rule reports: an import whose specifier matches, or a property read such as `process.env`. */
export type FamilyCheck =
  | { kind: 'import'; regex: string; typeImports: boolean }
  | { kind: 'member'; object: string; property?: string };

/**
 * A family's own ESLint rule, `archprint/<name>`. A core rule (`no-console`, `no-restricted-imports`) would share its
 * one configuration per file with the repo's settings for that rule, so whichever came last would silently win.
 */
export interface EslintFamilyRule {
  name: string;
  message: string;
  ignores: string[];
  check: FamilyCheck;
}

export const MAKE_FAMILY_RULE_FUNCTION = `function makeFamilyRule(spec) {
  const { check } = spec;
  const pattern = check.kind === 'import' ? new RegExp(check.regex) : null;
  return {
    meta: { type: 'problem', schema: [], messages: { forbidden: spec.message } },
    create(context) {
      const report = (node) => context.report({ node, messageId: 'forbidden' });
      if (pattern !== null) {
        return importVisitors((node, specifier) => {
          if (pattern.test(specifier)) report(node);
        }, check.typeImports);
      }
      return {
        MemberExpression(node) {
          if (
            !node.computed &&
            node.object.type === 'Identifier' &&
            node.object.name === check.object &&
            (check.property === undefined || node.property.name === check.property)
          ) {
            report(node);
          }
        },
      };
    },
  };
}`;

export const FAMILY_CONFIGS = `FAMILY_RULES.map((spec) => ({
  files: ${LINTED_FILES},
  ignores: spec.ignores,
  plugins: { archprint: plugin },
  rules: { ['archprint/' + spec.name]: 'error' },
}))`;
