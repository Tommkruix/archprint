import type { EnvAccessAnalysis } from '../detector/env-access-detector.js';
import { withMinedExemptions } from './console-isolation-emitters.js';
import type { EslintFamilyRule } from './eslint-family-rules.js';
import { CONFIG_GLOBS, TEST_GLOBS } from './eslint-scope.js';

export const ENV_ACCESS_RULE = 'env-access';

export function toEslintEnvAccess(analysis: EnvAccessAnalysis): EslintFamilyRule | null {
  if (analysis.subjectFileCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    name: ENV_ACCESS_RULE,
    message: 'Read environment variables only in the config/env layer.',
    ignores: withMinedExemptions([...TEST_GLOBS, ...CONFIG_GLOBS], analysis.violations),
    check: { kind: 'member', object: 'process', property: 'env' },
  };
}
