import type { WorkspacePackageAnalysis } from '../detector/workspace-package-detector.js';
import { withMinedExemptions } from './console-isolation-emitters.js';
import type { EslintFamilyRule } from './eslint-family-rules.js';
import { testGlobs } from './eslint-scope.js';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const WORKSPACE_PACKAGE_RULE = 'workspace-package';

export function toEslintWorkspacePackageApi(
  analysis: WorkspacePackageAnalysis,
  setupFiles: readonly string[] = [],
): EslintFamilyRule | null {
  if (analysis.consumerCount === 0 || analysis.packages.length === 0) return null;
  if (analysis.gate.status !== 'AUTO') return null;
  const group = analysis.packages.map(escapeRegExp).join('|');
  const exported = Object.entries(analysis.subpaths).filter(([, subpaths]) => subpaths.length > 0);
  return {
    name: WORKSPACE_PACKAGE_RULE,
    message:
      'Import a workspace package by its name or a subpath it exports, not a deep path into its source.',
    ignores: withMinedExemptions(testGlobs(setupFiles), analysis.violations),
    check: {
      kind: 'import',
      regex: `^(${group})/`,
      typeImports: false,
      ...(exported.length > 0 && { exports: Object.fromEntries(exported) }),
    },
  };
}
