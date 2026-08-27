import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { classifyFile, type Role } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

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

export function detectRoleLayering(
  appDir: string,
  options: RoleLayeringOptions = {},
): RoleLayeringAnalysis {
  const { root, files, adjacency } =
    options.graph ?? buildImportGraph(appDir, { resolve: options.resolve ?? false });

  const roleByFile = new Map<string, Role>();
  const roleFileCount = new Map<Role, number>();
  const confidenceSum = new Map<Role, number>();
  for (const file of files) {
    const { role, confidence } = classifyFile(file.relativePath);
    if (!LAYER_ROLES.has(role)) continue;
    roleByFile.set(file.relativePath, role);
    roleFileCount.set(role, (roleFileCount.get(role) ?? 0) + 1);
    confidenceSum.set(role, (confidenceSum.get(role) ?? 0) + confidence);
  }

  const edgeFiles = new Map<string, Map<string, string>>();
  for (const [file, targets] of adjacency) {
    const from = roleByFile.get(file);
    if (from === undefined) continue;
    for (const target of targets) {
      const to = roleByFile.get(target);
      if (to === undefined || to === from) continue;
      const key = `${from}>${to}`;
      let sources = edgeFiles.get(key);
      if (sources === undefined) {
        sources = new Map();
        edgeFiles.set(key, sources);
      }
      if (!sources.has(file)) sources.set(file, target);
    }
  }

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
      const roleConfidence = confidenceSum.get(from)! / count;
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
          .map(([file, target]) => ({ file, target }))
          .sort((x, y) => x.file.localeCompare(y.file)),
      });
    }
  }
  boundaries.sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  return { appDir: root, boundaries };
}
