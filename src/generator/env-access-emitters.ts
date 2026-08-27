import type { EnvAccessAnalysis } from '../detector/env-access-detector.js';
import type { EslintFlatConfigBlock } from './console-isolation-emitters.js';

export function toEslintEnvAccess(analysis: EnvAccessAnalysis): EslintFlatConfigBlock | null {
  if (analysis.envUserCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/config/**', '**/env/**', '**/environment/**', '**/*.config.*'],
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
