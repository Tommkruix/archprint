import type { GenerationStatus } from '../detector/confidence-gate.js';
import type { LayerBoundary } from '../detector/layer-detector.js';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

export interface EslintBoundariesElement {
  type: string;
  pattern: string;
}

export interface EslintBoundariesRule {
  from: string[];
  disallow: string[];
  message: string;
}

export interface EslintBoundariesConfig {
  settings: { 'boundaries/elements': EslintBoundariesElement[] };
  rules: {
    'boundaries/element-types': ['error', { default: 'allow'; rules: EslintBoundariesRule[] }];
  };
}

export function toEslintBoundaries(
  boundaries: readonly LayerBoundary[],
  include: readonly GenerationStatus[] = ['AUTO'],
): EslintBoundariesConfig {
  const chosen = selected(boundaries, include);
  const layers = [...new Set(chosen.flatMap((boundary) => [boundary.from, boundary.to]))].sort();
  const elements = layers.map((layer) => ({ type: layer, pattern: `**/${layer}/**` }));

  const disallowByFrom = new Map<string, Set<string>>();
  for (const boundary of chosen) {
    let targets = disallowByFrom.get(boundary.from);
    if (targets === undefined) {
      targets = new Set();
      disallowByFrom.set(boundary.from, targets);
    }
    targets.add(boundary.to);
  }
  const rules = [...disallowByFrom.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([from, targets]) => {
      const disallow = [...targets].sort();
      return {
        from: [from],
        disallow,
        message: `The "${from}" layer must not import: ${disallow.join(', ')} (inferred by Archprint from the observed import direction).`,
      };
    });

  return {
    settings: { 'boundaries/elements': elements },
    rules: { 'boundaries/element-types': ['error', { default: 'allow', rules }] },
  };
}
