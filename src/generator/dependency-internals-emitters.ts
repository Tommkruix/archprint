import type { DependencyInternalsAnalysis } from '../detector/dependency-internals-detector.js';

/** Matches a path inside a dependency's build/impl directory in node_modules (scoped or unscoped package). */
const INTERNAL_PATH =
  'node_modules/(?:@[^/]+/)?[^/]+/(?:dist|src|lib|esm|cjs|build|out|internal|internals)/';

export interface NoInternalsRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  /** First-party modules (not node_modules themselves). */
  from: { pathNot: string };
  /** A dependency's internal build/impl path. */
  to: { path: string };
}

export interface NoInternalsConfig {
  forbidden: NoInternalsRule[];
}

/**
 * Emit inferred dependency-internals isolation as a dependency-cruiser `forbidden` rule: a first-party module
 * may not import a third-party package's build/impl directory. Returns an empty ruleset unless the analysis is
 * enforceable (AUTO) and the app imports external packages at all.
 */
export function toDependencyCruiserDependencyInternals(
  analysis: DependencyInternalsAnalysis,
): NoInternalsConfig {
  if (analysis.externalImporterCount === 0 || analysis.gate.status !== 'AUTO') {
    return { forbidden: [] };
  }
  const conform = analysis.externalImporterCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: 'no-dependency-internals',
        comment: `Archprint inferred dependency hygiene: ${conform}/${analysis.externalImporterCount} files import third-party packages only by their public entry; reaching into a package's build/impl directory is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: { pathNot: 'node_modules' },
        to: { path: INTERNAL_PATH },
      },
    ],
  };
}
