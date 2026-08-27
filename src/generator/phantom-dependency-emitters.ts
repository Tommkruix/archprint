import type { PhantomDependencyAnalysis } from '../detector/phantom-dependency-detector.js';

export interface PhantomDependencyRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { pathNot: string };
  to: { dependencyTypes: string[] };
}

export interface PhantomDependencyConfig {
  forbidden: PhantomDependencyRule[];
}

export function toDependencyCruiserPhantomDependencies(
  analysis: PhantomDependencyAnalysis,
): PhantomDependencyConfig {
  if (analysis.externalImporterCount === 0 || analysis.gate.status !== 'AUTO') {
    return { forbidden: [] };
  }
  const conform = analysis.externalImporterCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: 'no-phantom-dependencies',
        comment: `Archprint inferred dependency declaration: ${conform}/${analysis.externalImporterCount} files import only packages declared in package.json; importing an undeclared (phantom/transitive) dependency is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: { pathNot: 'node_modules' },
        to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
      },
    ],
  };
}
