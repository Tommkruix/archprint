import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { classifyFile, type Role } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult, wilsonLowerBound } from './confidence-gate.js';

const LAYER_ROLES: ReadonlySet<Role> = new Set([
  'CONTROLLER',
  'SERVICE',
  'REPOSITORY',
  'DATA_ACCESS',
  'DB_MODULE',
]);

export interface RoleBoundaryViolation {
  file: string;
  target: string;
}

export interface RoleBoundary {
  from: Role;
  to: Role;
  roleFileCount: number;
  conformingFileCount: number;
  violatingFileCount: number;
  reverseFlow: number;
  roleConfidence: number;
  gate: GateResult;
  violations: RoleBoundaryViolation[];
}

export interface RoleLayeringAnalysis {
  appDir: string;
  boundaries: RoleBoundary[];
}

export interface RoleLayeringOptions {
  graph?: ImportGraph;
  resolve?: boolean;
}

/** The layer role of each file in the graph that has one. */
function layerRoles(graph: ImportGraph): Map<string, Role> {
  const roles = new Map<string, Role>();
  for (const file of graph.files) {
    const { role } = classifyFile(file.relativePath);
    if (LAYER_ROLES.has(role)) roles.set(file.relativePath, role);
  }
  return roles;
}

/** For each `from>to` role pair, the files importing across it and every target they import there. */
function roleEdges(graph: ImportGraph): Map<string, Map<string, string[]>> {
  const roleByFile = layerRoles(graph);
  const edges = new Map<string, Map<string, string[]>>();
  for (const [file, targets] of graph.adjacency) {
    const from = roleByFile.get(file);
    if (from === undefined) continue;
    for (const target of targets) {
      const to = roleByFile.get(target);
      if (to === undefined || to === from) continue;
      const key = `${from}>${to}`;
      let sources = edges.get(key);
      if (sources === undefined) {
        sources = new Map();
        edges.set(key, sources);
      }
      const imported = sources.get(file);
      if (imported === undefined) sources.set(file, [target]);
      else imported.push(target);
    }
  }
  return edges;
}

export type RoleImportLookup = (from: Role, to: Role) => RoleBoundaryViolation[];

/** Every import from one role layer into another, the way the role-layering rules enforce. */
export function roleLayeringImports(appDir: string): RoleImportLookup {
  const edges = roleEdges(buildImportGraph(appDir, { resolve: false }));
  return (from, to) =>
    [...(edges.get(`${from}>${to}`)?.entries() ?? [])].flatMap(([file, targets]) =>
      targets.map((target) => ({ file, target })),
    );
}

export function detectRoleLayering(
  appDir: string,
  options: RoleLayeringOptions = {},
): RoleLayeringAnalysis {
  const graph = options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });
  const { root, files } = graph;

  const roleFileCount = new Map<Role, number>();
  const confidenceSum = new Map<Role, number>();
  for (const file of files) {
    const { role, confidence } = classifyFile(file.relativePath);
    if (!LAYER_ROLES.has(role)) continue;
    roleFileCount.set(role, (roleFileCount.get(role) ?? 0) + 1);
    confidenceSum.set(role, (confidenceSum.get(role) ?? 0) + confidence);
  }

  const edgeFiles = roleEdges(graph);

  const edgeSize = (from: Role, to: Role): number => edgeFiles.get(`${from}>${to}`)?.size ?? 0;
  const roles = [...roleFileCount.keys()].sort();

  const boundaries: RoleBoundary[] = [];
  for (let i = 0; i < roles.length; i += 1) {
    for (let j = i + 1; j < roles.length; j += 1) {
      const a = roles[i]!;
      const b = roles[j]!;
      const ab = edgeSize(a, b);
      const ba = edgeSize(b, a);
      if (ab === 0 && ba === 0) continue;
      const [from, to, violating, reverseFlow] = ab <= ba ? [a, b, ab, ba] : [b, a, ba, ab];
      const count = roleFileCount.get(from)!;
      const classificationConfidence = confidenceSum.get(from)! / count;
      const directionalConfidence = wilsonLowerBound(reverseFlow, violating + reverseFlow);
      const roleConfidence = Math.min(classificationConfidence, directionalConfidence);
      boundaries.push({
        from,
        to,
        roleFileCount: count,
        conformingFileCount: count - violating,
        violatingFileCount: violating,
        reverseFlow,
        roleConfidence,
        gate: evaluateGate({ roleFileCount: count, violatingFileCount: violating, roleConfidence }),
        violations: [...(edgeFiles.get(`${from}>${to}`)?.entries() ?? [])]
          .map(([file, targets]) => ({ file, target: targets[0]! }))
          .sort((x, y) => x.file.localeCompare(y.file)),
      });
    }
  }
  boundaries.sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  return { appDir: root, boundaries };
}
