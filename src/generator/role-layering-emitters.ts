import type { GenerationStatus } from '../detector/confidence-gate.js';
import type { RoleBoundary } from '../detector/role-layering-detector.js';
import { ROLE_PATTERNS } from '../scanner/role-classifier.js';
import type { Role } from '../scanner/role-classifier.js';

const rolePath = (role: Role): string => {
  const sources = (ROLE_PATTERNS.get(role) ?? []).map((pattern) => pattern.source);
  return sources.length === 1 ? sources[0]! : `(${sources.join('|')})`;
};

const confidencePct = (boundary: RoleBoundary): string =>
  `${(boundary.gate.conditions.confidence.value * 100).toFixed(0)}%`;

export interface RoleLayeringRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { path: string };
  to: { path: string };
}

export interface RoleLayeringConfig {
  forbidden: RoleLayeringRule[];
}

export function toDependencyCruiserRoleLayering(
  boundaries: readonly RoleBoundary[],
  include: readonly GenerationStatus[] = ['AUTO'],
): RoleLayeringConfig {
  const forbidden = boundaries
    .filter((boundary) => include.includes(boundary.gate.status))
    .map((boundary) => ({
      name: `no-${boundary.from.toLowerCase()}-to-${boundary.to.toLowerCase()}`,
      comment: `Archprint inferred role layering: ${boundary.reverseFlow} ${boundary.to} file(s) depend on ${boundary.from}, not the reverse; a ${boundary.from} must not import a ${boundary.to} (confidence ${confidencePct(boundary)}).`,
      severity: 'error' as const,
      from: { path: rolePath(boundary.from) },
      to: { path: rolePath(boundary.to) },
    }));
  return { forbidden };
}
