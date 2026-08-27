import type { ServerClientAnalysis } from '../detector/server-client-detector.js';

export interface ServerClientRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { path: string };
  to: { path: string };
}

export interface ServerClientConfig {
  forbidden: ServerClientRule[];
}

export function toDependencyCruiserServerClient(
  analysis: ServerClientAnalysis,
): ServerClientConfig {
  if (analysis.clientCount === 0 || analysis.gate.status !== 'AUTO') return { forbidden: [] };
  const conform = analysis.clientCount - analysis.offenderCount;
  const floor = `${(analysis.gate.conditions.confidence.value * 100).toFixed(0)}%`;
  return {
    forbidden: [
      {
        name: 'no-server-only-in-client',
        comment: `Archprint inferred server/client boundary: ${conform}/${analysis.clientCount} "use client" modules import no server-only code; a client component importing a server-only module is forbidden (confidence ${floor}).`,
        severity: 'error',
        from: { path: '\\.(ts|tsx)$' },
        to: { path: 'node_modules/server-only' },
      },
    ],
  };
}
