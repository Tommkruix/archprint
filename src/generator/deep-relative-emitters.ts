import type { DeepRelativeAnalysis } from '../detector/deep-relative-detector.js';

export interface NoRestrictedImportsPattern {
  regex: string;
  message: string;
}

export interface EslintNoRestrictedImportsConfig {
  ignores?: string[];
  rules: {
    'no-restricted-imports': ['error', { patterns: NoRestrictedImportsPattern[] }];
  };
}

export function exemptImporters(
  violations: readonly { file: string }[],
): Pick<EslintNoRestrictedImportsConfig, 'ignores'> {
  return violations.length > 0 ? { ignores: violations.map((violation) => violation.file) } : {};
}

export function toEslintDeepRelative(
  analysis: DeepRelativeAnalysis,
): EslintNoRestrictedImportsConfig | null {
  if (analysis.relativeImporterCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    ...exemptImporters(analysis.violations),
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(\\.\\./){3,}',
              message: 'Deep relative import: use a workspace alias instead of ../../../',
            },
          ],
        },
      ],
    },
  };
}
