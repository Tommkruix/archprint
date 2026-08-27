import type { EntryPurityAnalysis } from '../detector/entry-purity-detector.js';
import { ROLE_PATTERNS } from '../scanner/role-classifier.js';
import type { Role } from '../scanner/role-classifier.js';

const ENTRY_ROLES: readonly Role[] = ['ROUTE_ENTRY', 'ROUTE_HANDLER', 'API_HANDLER'];

const entryPath = (): string => {
  const sources = ENTRY_ROLES.flatMap((role) =>
    (ROLE_PATTERNS.get(role) ?? []).map((pattern) => pattern.source),
  );
  return `(${sources.join('|')})`;
};

export interface EntryPurityRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { pathNot: string };
  to: { path: string };
}

export interface EntryPurityConfig {
  forbidden: EntryPurityRule[];
}

export function toDependencyCruiserEntryPurity(analysis: EntryPurityAnalysis): EntryPurityConfig {
  if (analysis.entryCount === 0 || analysis.gate.status !== 'AUTO') return { forbidden: [] };
  const conform = analysis.entryCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: 'no-import-framework-entry',
        comment: `Archprint inferred entry purity: ${conform}/${analysis.entryCount} framework entries (pages, routes) are loaded by the framework and imported by nothing; importing a framework entry from other code is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: { pathNot: 'node_modules' },
        to: { path: entryPath() },
      },
    ],
  };
}
