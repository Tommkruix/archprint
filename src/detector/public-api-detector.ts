import { buildImportGraph, type ImportGraph } from '../scanner/import-graph.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

const dirOf = (relativePath: string): string => {
  const slash = relativePath.lastIndexOf('/');
  return slash === -1 ? '' : relativePath.slice(0, slash);
};

const isBarrelName = (relativePath: string): boolean => {
  const slash = relativePath.lastIndexOf('/');
  const base = slash === -1 ? relativePath : relativePath.slice(slash + 1);
  return base === 'index.ts' || base === 'index.tsx';
};

const isUnder = (file: string, dir: string): boolean => file.startsWith(`${dir}/`);

export interface PublicApiViolation {
  file: string;
  target: string;
}

export interface PublicApiGroup {
  dir: string;
  internalCount: number;
  consumerCount: number;
  deepImporterCount: number;
  gate: GateResult;
  violations: PublicApiViolation[];
}

export interface PublicApiAnalysis {
  appDir: string;
  groups: PublicApiGroup[];
}

export interface PublicApiDetectorOptions {
  graph?: ImportGraph;
}

export function detectPublicApiBoundaries(
  appDir: string,
  options: PublicApiDetectorOptions = {},
): PublicApiAnalysis {
  const { root, files, adjacency } = options.graph ?? buildImportGraph(appDir, { resolve: false });

  const barrelDirs = new Set<string>();
  for (const file of files) {
    if (isBarrelName(file.relativePath)) {
      const dir = dirOf(file.relativePath);
      if (dir !== '') barrelDirs.add(dir);
    }
  }
  if (barrelDirs.size === 0) return { appDir: root, groups: [] };

  const nearestBarrel = (target: string): string | null => {
    for (let dir = dirOf(target); dir !== ''; dir = dirOf(dir)) {
      if (barrelDirs.has(dir)) return dir;
    }
    return null;
  };
  const isBarrelFile = (dir: string, target: string): boolean =>
    target === `${dir}/index.ts` || target === `${dir}/index.tsx`;

  const internalCount = new Map<string, number>();
  for (const dir of barrelDirs) internalCount.set(dir, 0);
  for (const file of files) {
    const dir = nearestBarrel(file.relativePath);
    if (dir !== null && !isBarrelFile(dir, file.relativePath)) {
      internalCount.set(dir, internalCount.get(dir)! + 1);
    }
  }

  const consumers = new Map<string, Set<string>>();
  const deepImporters = new Map<string, Set<string>>();
  const violations = new Map<string, PublicApiViolation[]>();
  for (const dir of barrelDirs) {
    consumers.set(dir, new Set());
    deepImporters.set(dir, new Set());
    violations.set(dir, []);
  }

  for (const [file, targets] of adjacency) {
    for (const target of targets) {
      const dir = nearestBarrel(target);
      if (dir === null) continue;
      if (file === `${dir}/index.ts` || file === `${dir}/index.tsx` || isUnder(file, dir)) continue;
      consumers.get(dir)!.add(file);
      if (!isBarrelFile(dir, target)) {
        deepImporters.get(dir)!.add(file);
        violations.get(dir)!.push({ file, target });
      }
    }
  }

  const groups: PublicApiGroup[] = [];
  for (const dir of barrelDirs) {
    const consumerCount = consumers.get(dir)!.size;
    const internals = internalCount.get(dir)!;
    if (internals === 0 || consumerCount === 0) continue;
    const deepImporterCount = deepImporters.get(dir)!.size;
    groups.push({
      dir,
      internalCount: internals,
      consumerCount,
      deepImporterCount,
      gate: evaluateGate({
        roleFileCount: consumerCount,
        violatingFileCount: deepImporterCount,
        roleConfidence: 1,
      }),
      violations: violations.get(dir)!.sort((a, b) => a.file.localeCompare(b.file)),
    });
  }
  groups.sort((a, b) => a.dir.localeCompare(b.dir));
  return { appDir: root, groups };
}
