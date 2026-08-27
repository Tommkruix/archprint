import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

interface Membership {
  container: string;
  member: string;
}

/** The (container, member) a file belongs to: the first container segment with a member directory beneath it
 *  that itself contains the file. Returns null for files directly in a container or outside any container. */
function memberOf(relativePath: string, containers: ReadonlySet<string>): Membership | null {
  const segments = relativePath.split('/');
  for (let i = 0; i < segments.length; i += 1) {
    // segments[i] is a container, segments[i+1] is the member dir, and something lives beneath it.
    if (containers.has(segments[i]!) && i + 2 <= segments.length - 1) {
      return { container: segments.slice(0, i + 1).join('/'), member: segments[i + 1]! };
    }
  }
  return null;
}

export interface SiblingViolation {
  /** The member file that imports a sibling member. */
  file: string;
  /** The sibling-member file it imports. */
  target: string;
}

export interface SiblingGroup {
  /** The container directory holding the members, e.g. `src/features` or `apps`. */
  container: string;
  /** Distinct sibling members under the container. */
  memberCount: number;
  /** Files living in any member of the container (the role sample). */
  memberFileCount: number;
  /** Member files that import a different sibling member. */
  crossImporterCount: number;
  gate: GateResult;
  violations: SiblingViolation[];
}

export interface SiblingIsolationOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

/**
 * Generic sibling-isolation detector: within each container directory, its immediate member directories should
 * not import one another. A member file that imports a different sibling member is a cross-import violation,
 * gated by the Wilson floor. Only containers with at least two members are considered. Shared by the
 * feature-slice and app-isolation detectors so the traversal and gating live in one place.
 */
export function detectSiblingIsolation(
  appDir: string,
  containers: ReadonlySet<string>,
  options: SiblingIsolationOptions = {},
): { appDir: string; groups: SiblingGroup[] } {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const memberByFile = new Map<string, Membership>();
  const membersByContainer = new Map<string, Set<string>>();
  const fileCountByContainer = new Map<string, number>();
  for (const file of files) {
    const member = memberOf(file.relativePath, containers);
    if (member === null) continue;
    memberByFile.set(file.relativePath, member);
    let members = membersByContainer.get(member.container);
    if (members === undefined) {
      members = new Set();
      membersByContainer.set(member.container, members);
    }
    members.add(member.member);
    fileCountByContainer.set(
      member.container,
      (fileCountByContainer.get(member.container) ?? 0) + 1,
    );
  }

  const crossImporters = new Map<string, Set<string>>();
  const violations = new Map<string, SiblingViolation[]>();
  for (const [file, targets] of adjacency) {
    const from = memberByFile.get(file);
    if (from === undefined) continue;
    for (const target of targets) {
      const to = memberByFile.get(target);
      if (to === undefined || to.container !== from.container || to.member === from.member)
        continue;
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

  const groups: SiblingGroup[] = [];
  for (const [container, members] of membersByContainer) {
    if (members.size < 2) continue;
    const memberFileCount = fileCountByContainer.get(container)!;
    const crossImporterCount = crossImporters.get(container)?.size ?? 0;
    groups.push({
      container,
      memberCount: members.size,
      memberFileCount,
      crossImporterCount,
      gate: evaluateGate({
        roleFileCount: memberFileCount,
        violatingFileCount: crossImporterCount,
        roleConfidence: 1,
      }),
      violations: (violations.get(container) ?? []).sort((a, b) => a.file.localeCompare(b.file)),
    });
  }
  groups.sort((a, b) => a.container.localeCompare(b.container));
  return { appDir: root, groups };
}
