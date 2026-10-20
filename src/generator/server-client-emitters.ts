import {
  SERVER_ONLY_PACKAGE,
  type ServerClientAnalysis,
} from '../detector/server-client-detector.js';
import { exactAppFiles, exemptDepcruiseFrom, TEST_ROLE_REGEX } from './depcruise-exempt.js';

export const SERVER_CLIENT_RULE = 'no-server-only-in-client';

export interface ServerClientRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { path: string; pathNot: string | string[] };
  to: { path: string | string[]; dependencyTypesNot: string[] };
}

export interface ServerClientConfig {
  forbidden: ServerClientRule[];
}

/**
 * The "use client" files the scan found must not import a server-only module or the server-only package. Files
 * that become client components after generation are not covered until the next generate.
 */
export function toDependencyCruiserServerClient(
  analysis: ServerClientAnalysis,
  appPath: string,
  allowedFor: (ruleId: string) => readonly string[],
): ServerClientConfig {
  if (analysis.clientCount === 0 || analysis.gate.status !== 'AUTO') return { forbidden: [] };
  const conform = analysis.clientCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  const serverOnlyPackage = `(^|/)node_modules/${SERVER_ONLY_PACKAGE}/`;
  return {
    forbidden: [
      {
        name: SERVER_CLIENT_RULE,
        comment: `Archprint inferred server/client boundary: ${conform}/${analysis.clientCount} "use client" modules import no server-only code; a client component importing a server-only module is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: {
          path: exactAppFiles(analysis.clients, appPath),
          pathNot: exemptDepcruiseFrom(TEST_ROLE_REGEX, [
            ...analysis.violations,
            ...allowedFor(SERVER_CLIENT_RULE).map((file) => ({ file })),
          ]),
        },
        to: {
          path:
            analysis.serverModules.length === 0
              ? serverOnlyPackage
              : [exactAppFiles(analysis.serverModules, appPath), serverOnlyPackage],
          dependencyTypesNot: ['type-only'],
        },
      },
    ],
  };
}
