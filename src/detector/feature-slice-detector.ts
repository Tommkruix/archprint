import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

/** Directory names that conventionally hold sibling feature slices (feature-sliced / modular designs). */
const CONTAINER_NAMES = new Set(['features', 'modules', 'slices', 'domains']);

interface Slice {
  container: string;
  slice: string;
}

/** The (container, slice) a file belongs to: the first container segment with a slice directory beneath it
 *  that itself contains the file. Returns null for files directly in a container or outside any container. */
function sliceOf(relativePath: string): Slice | null {
  const segments = relativePath.split('/');
  for (let i = 0; i < segments.length; i += 1) {
    // segments[i] is a container, segments[i+1] is the slice dir, and something lives beneath it.
    if (CONTAINER_NAMES.has(segments[i]!) && i + 2 <= segments.length - 1) {
      return { container: segments.slice(0, i + 1).join('/'), slice: segments[i + 1]! };
    }
  }
  return null;
}

export interface FeatureSliceViolation {
  /** The slice file that imports a sibling slice. */
  file: string;
  /** The sibling-slice file it imports. */
  target: string;
}

export interface FeatureSliceGroup {
  /** The container directory holding the slices, e.g. `src/features`. */
  container: string;
  /** Distinct sibling slices under the container. */
  sliceCount: number;
  /** Files living in any slice of the container (the role sample). */
  sliceFileCount: number;
  /** Slice files that import a different sibling slice. */
  crossImporterCount: number;
  gate: GateResult;
  violations: FeatureSliceViolation[];
}

export interface FeatureSliceAnalysis {
  appDir: string;
  groups: FeatureSliceGroup[];
}

export interface FeatureSliceDetectorOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

/**
 * Infer feature-slice isolation. A container directory (`features`, `modules`, `slices`, `domains`) holds
 * sibling slices that should not import one another. Each slice file that imports a different sibling slice is
 * a cross-slice violation; the Wilson gate decides whether "slices under <container> must not import each
 * other" is enforceable (AUTO), provisional (SUGGEST), or unsupported. Only containers with at least two
 * slices are considered.
 */
export function detectFeatureSliceIsolation(
  appDir: string,
  options: FeatureSliceDetectorOptions = {},
): FeatureSliceAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const sliceByFile = new Map<string, Slice>();
  const slicesByContainer = new Map<string, Set<string>>();
  const fileCountByContainer = new Map<string, number>();
  for (const file of files) {
    const slice = sliceOf(file.relativePath);
    if (slice === null) continue;
    sliceByFile.set(file.relativePath, slice);
    let slices = slicesByContainer.get(slice.container);
    if (slices === undefined) {
      slices = new Set();
      slicesByContainer.set(slice.container, slices);
    }
    slices.add(slice.slice);
    fileCountByContainer.set(slice.container, (fileCountByContainer.get(slice.container) ?? 0) + 1);
  }

  const crossImporters = new Map<string, Set<string>>();
  const violations = new Map<string, FeatureSliceViolation[]>();
  for (const [file, targets] of adjacency) {
    const from = sliceByFile.get(file);
    if (from === undefined) continue;
    for (const target of targets) {
      const to = sliceByFile.get(target);
      if (to === undefined || to.container !== from.container || to.slice === from.slice) continue;
      let importers = crossImporters.get(from.container);
      if (importers === undefined) {
        importers = new Set();
        crossImporters.set(from.container, importers);
      }
      importers.add(file);
      let recorded = violations.get(from.container);
      if (recorded === undefined) {
        recorded = [];
        violations.set(from.container, recorded);
      }
      recorded.push({ file, target });
    }
  }

  const groups: FeatureSliceGroup[] = [];
  for (const [container, slices] of slicesByContainer) {
    if (slices.size < 2) continue;
    const sliceFileCount = fileCountByContainer.get(container)!;
    const crossImporterCount = crossImporters.get(container)?.size ?? 0;
    groups.push({
      container,
      sliceCount: slices.size,
      sliceFileCount,
      crossImporterCount,
      gate: evaluateGate({
        roleFileCount: sliceFileCount,
        violatingFileCount: crossImporterCount,
        roleConfidence: 1,
      }),
      violations: (violations.get(container) ?? []).sort((a, b) => a.file.localeCompare(b.file)),
    });
  }
  groups.sort((a, b) => a.container.localeCompare(b.container));
  return { appDir: root, groups };
}
