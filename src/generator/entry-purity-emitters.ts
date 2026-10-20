import { ENTRY_ROLES, type EntryPurityAnalysis } from '../detector/entry-purity-detector.js';
import { ROLE_PATTERNS } from '../scanner/role-classifier.js';
import { exemptDepcruiseFrom, TEST_ROLE_REGEX } from './depcruise-exempt.js';

export const ENTRY_PURITY_RULE = 'no-import-framework-entry';

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
  from: { pathNot: string | string[] };
  to: { path: string; pathNot?: string | string[]; dependencyTypesNot: string[] };
}

export interface EntryPurityConfig {
  forbidden: EntryPurityRule[];
}

/** Dependency-cruiser cannot exempt a single import, so an entry already imported is exempt as a target. */
export function toDependencyCruiserEntryPurity(
  analysis: EntryPurityAnalysis,
  allowedFor: (ruleId: string) => readonly string[],
): EntryPurityConfig {
  if (analysis.entryCount === 0 || analysis.gate.status !== 'AUTO') return { forbidden: [] };
  const conform = analysis.entryCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  const importedEntries = [...new Set(analysis.imports.map((entry) => entry.file))].map((file) => ({
    file,
  }));
  return {
    forbidden: [
      {
        name: ENTRY_PURITY_RULE,
        comment: `Archprint inferred entry purity: ${conform}/${analysis.entryCount} framework entries (pages, routes) are loaded by the framework and imported by nothing; importing a framework entry from other code is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: {
          pathNot: exemptDepcruiseFrom(
            ['node_modules', TEST_ROLE_REGEX, entryPath()],
            allowedFor(ENTRY_PURITY_RULE).map((file) => ({ file })),
          ),
        },
        to: {
          path: entryPath(),
          ...(importedEntries.length === 0
            ? {}
            : { pathNot: exemptDepcruiseFrom([], importedEntries) }),
          dependencyTypesNot: ['type-only'],
        },
      },
    ],
  };
}
