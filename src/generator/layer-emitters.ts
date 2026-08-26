import type { GenerationStatus } from '../detector/confidence-gate.js';
import type { LayerBoundary } from '../detector/layer-detector.js';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Path regex matching files in a layer (a directory of that name), for tools that match module paths. */
const layerPath = (layer: string): string => `(^|/)${escapeRegExp(layer)}/`;

const confidencePct = (boundary: LayerBoundary): string =>
  `${(boundary.gate.conditions.confidence.value * 100).toFixed(0)}%`;

const selected = (
  boundaries: readonly LayerBoundary[],
  include: readonly GenerationStatus[],
): LayerBoundary[] => boundaries.filter((boundary) => include.includes(boundary.gate.status));

export interface DependencyCruiserRule {
  name: string;
  comment: string;
  severity: 'error' | 'warn' | 'info';
  from: { path: string };
  to: { path: string };
}

export interface DependencyCruiserConfig {
  forbidden: DependencyCruiserRule[];
}

/**
 * Emit inferred layer boundaries as a dependency-cruiser `forbidden` ruleset: one rule per boundary, where a
 * file in the `from` layer must not depend on the `to` layer. Only AUTO boundaries by default (enforceable);
 * pass a wider `include` to also emit SUGGEST boundaries.
 */
export function toDependencyCruiser(
  boundaries: readonly LayerBoundary[],
  include: readonly GenerationStatus[] = ['AUTO'],
): DependencyCruiserConfig {
  const forbidden = selected(boundaries, include).map((boundary) => ({
    name: `no-${boundary.from}-to-${boundary.to}`,
    comment: `Archprint inferred boundary: the "${boundary.to}" layer depends on "${boundary.from}" across ${boundary.reverseFlow} file(s); the reverse is forbidden (confidence ${confidencePct(boundary)}).`,
    severity: 'error' as const,
    from: { path: layerPath(boundary.from) },
    to: { path: layerPath(boundary.to) },
  }));
  return { forbidden };
}
