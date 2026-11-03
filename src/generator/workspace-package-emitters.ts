import type { WorkspacePackageAnalysis } from '../detector/workspace-package-detector.js';
import { withMinedExemptions } from './console-isolation-emitters.js';
import type { EslintFamilyRule } from './eslint-family-rules.js';
import { TEST_GLOBS } from './eslint-scope.js';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const WORKSPACE_PACKAGE_RULE = 'workspace-package';

export function toEslintWorkspacePackageApi(
  analysis: WorkspacePackageAnalysis,
): EslintFamilyRule | null {
  if (analysis.consumerCount === 0 || analysis.packages.length === 0) return null;
  if (analysis.gate.status !== 'AUTO') return null;
  const group = analysis.packages.map(escapeRegExp).join('|');
  return {
    name: WORKSPACE_PACKAGE_RULE,
    message: 'Import a workspace package by its name, not a deep path into its source.',
    ignores: withMinedExemptions([...TEST_GLOBS], analysis.violations),
    check: { kind: 'import', regex: `^(${group})/`, typeImports: false },
  };
}
