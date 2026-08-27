import type { WorkspacePackageAnalysis } from '../detector/workspace-package-detector.js';
import type { EslintNoRestrictedImportsConfig } from './deep-relative-emitters.js';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function toEslintWorkspacePackageApi(
  analysis: WorkspacePackageAnalysis,
): EslintNoRestrictedImportsConfig | null {
  if (analysis.consumerCount === 0 || analysis.packages.length === 0) return null;
  if (analysis.gate.status !== 'AUTO') return null;
  const group = analysis.packages.map(escapeRegExp).join('|');
  return {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `^(${group})/`,
              message: 'Import a workspace package by its name, not a deep path into its source.',
            },
          ],
        },
      ],
    },
  };
}
