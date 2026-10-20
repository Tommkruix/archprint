import type { DependencyInternalsAnalysis } from '../detector/dependency-internals-detector.js';
import { exemptDepcruiseFrom, TEST_ROLE_REGEX } from './depcruise-exempt.js';

export const DEPENDENCY_INTERNALS_RULE = 'no-dependency-internals';

const INTERNAL_PATH = 'node_modules/(?:@[^/]+/)?[^/]+/(?:src|internal|internals)/';

export interface NoInternalsRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { pathNot: string | string[] };
  to: { path: string };
}

export interface NoInternalsConfig {
  forbidden: NoInternalsRule[];
}

export function toDependencyCruiserDependencyInternals(
  analysis: DependencyInternalsAnalysis,
  allowedFor: (ruleId: string) => readonly string[],
): NoInternalsConfig {
  if (analysis.externalImporterCount === 0 || analysis.gate.status !== 'AUTO') {
    return { forbidden: [] };
  }
  const conform = analysis.externalImporterCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: DEPENDENCY_INTERNALS_RULE,
        comment: `Archprint inferred dependency hygiene: ${conform}/${analysis.externalImporterCount} files import third-party packages only by their public entry; reaching into a package's build/impl directory is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: {
          pathNot: exemptDepcruiseFrom(
            [TEST_ROLE_REGEX, 'node_modules'],
            [
              ...analysis.violations,
              ...allowedFor(DEPENDENCY_INTERNALS_RULE).map((file) => ({ file })),
            ],
          ),
        },
        to: { path: INTERNAL_PATH },
      },
    ],
  };
}
