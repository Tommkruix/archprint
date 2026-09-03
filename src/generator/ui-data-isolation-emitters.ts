import type { UiDataIsolationAnalysis } from '../detector/ui-data-isolation-detector.js';
import { ROLE_PATTERNS } from '../scanner/role-classifier.js';
import type { Role } from '../scanner/role-classifier.js';

const DATA_ROLES: readonly Role[] = ['DB_MODULE', 'DATA_ACCESS'];

const dataPath = (): string => {
  const sources = DATA_ROLES.flatMap((role) =>
    (ROLE_PATTERNS.get(role) ?? []).map((pattern) => pattern.source),
  );
  return `(${sources.join('|')})`;
};

const componentPath = (): string => {
  const sources = (ROLE_PATTERNS.get('COMPONENT') ?? []).map((pattern) => pattern.source);
  return sources.length > 0 ? `(${sources.join('|')})` : '\\.tsx$';
};

export interface UiDataRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { path: string };
  to: { path: string };
}

export interface UiDataConfig {
  forbidden: UiDataRule[];
}

export function toDependencyCruiserUiData(analysis: UiDataIsolationAnalysis): UiDataConfig {
  if (analysis.componentCount === 0 || analysis.gate.status !== 'AUTO') return { forbidden: [] };
  const conform = analysis.componentCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: 'no-ui-to-data',
        comment: `Archprint inferred UI/data separation: ${conform}/${analysis.componentCount} UI components reach the data layer only through services, not directly; a component importing the DB/data layer is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: { path: componentPath() },
        to: { path: dataPath() },
      },
    ],
  };
}
