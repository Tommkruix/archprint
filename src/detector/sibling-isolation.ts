import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

interface Membership {
  container: string;
  member: string;
}

function memberOf(relativePath: string, containers: ReadonlySet<string>): Membership | null {
  const segments = relativePath.split('/');
  for (let i = 0; i < segments.length; i += 1) {
    if (containers.has(segments[i]!) && i + 2 <= segments.length - 1) {
      return { container: segments.slice(0, i + 1).join('/'), member: segments[i + 1]! };
    }
  }
  return null;
}

export interface SiblingViolation {
  file: string;
  target: string;
}

export interface SiblingGroup {
  container: string;
  memberCount: number;
  memberFileCount: number;
  crossImporterCount: number;
  gate: GateResult;
  violations: SiblingViolation[];
}

export interface SiblingIsolationOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

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
