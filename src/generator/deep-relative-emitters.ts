import type { DeepRelativeAnalysis } from '../detector/deep-relative-detector.js';
import { withMinedExemptions } from './console-isolation-emitters.js';
import type { EslintFamilyRule } from './eslint-family-rules.js';
import { TEST_GLOBS } from './eslint-scope.js';

export function toEslintDeepRelative(analysis: DeepRelativeAnalysis): EslintFamilyRule | null {
  if (analysis.relativeImporterCount === 0 || analysis.gate.status !== 'AUTO') return null;
  return {
    name: 'import-style',
    message: 'Deep relative import: use a workspace alias instead of ../../../',
    ignores: withMinedExemptions([...TEST_GLOBS], analysis.violations),
    check: { kind: 'import', regex: '^(\\.\\./){3,}', typeImports: true },
  };
}
