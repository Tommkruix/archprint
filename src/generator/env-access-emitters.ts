import type { EnvAccessAnalysis } from '../detector/env-access-detector.js';
import { withMinedExemptions, type EslintFlatConfigBlock } from './console-isolation-emitters.js';
import { CONFIG_GLOBS, TEST_GLOBS } from './eslint-scope.js';

export function toEslintEnvAccess(analysis: EnvAccessAnalysis): EslintFlatConfigBlock | null {
  if (analysis.subjectFileCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    files: ['**/*.{ts,tsx}'],
    ignores: withMinedExemptions([...TEST_GLOBS, ...CONFIG_GLOBS], analysis.violations),
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read environment variables only in the config/env layer.',
        },
      ],
    },
  };
}
