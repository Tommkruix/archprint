import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GenerationStatus } from '../detector/confidence-gate.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from '../scanner/workspace-packages.js';
import type { ScanResult } from './scan.js';

type FamilyStatus = 'AUTO' | 'SUGGEST' | 'NONE';

interface Family {
  title: string;
  status: (scan: ScanResult) => FamilyStatus;
  universal: boolean;
  frameworks: readonly string[];
}

const groupsStatus = (groups: readonly { gate: { status: GenerationStatus } }[]): FamilyStatus => {
  if (groups.some((g) => g.gate.status === 'AUTO')) return 'AUTO';
  if (groups.some((g) => g.gate.status === 'SUGGEST')) return 'SUGGEST';
  return 'NONE';
};

const gatedStatus = (population: number, status: GenerationStatus): FamilyStatus => {
  if (population === 0) return 'NONE';
  return status === 'AUTO' ? 'AUTO' : status === 'SUGGEST' ? 'SUGGEST' : 'NONE';
};

const FAMILIES: readonly Family[] = [
  {
    title: 'Forbidden imports (DB client / UI in server entries)',
    universal: false,
    frameworks: ['next', 'nest', 'remix'],
    status: (s) => groupsStatus(s.patterns.map((p) => p.result)),
  },
  {
    title: 'Layer boundaries',
    universal: true,
    frameworks: [],
    status: (s) => groupsStatus(s.layerBoundaries),
  },
  {
    title: 'Role layering',
    universal: false,
    frameworks: ['nest'],
    status: (s) => groupsStatus(s.roleLayering.boundaries),
  },
  {
    title: 'Circular dependencies',
    universal: true,
    frameworks: [],
    status: (s) => gatedStatus(s.cycles.fileCount, s.cycles.gate.status),
  },
  {
    title: 'Public API (barrels)',
    universal: false,
    frameworks: ['react', 'vue', 'next'],
    status: (s) => groupsStatus(s.publicApi.groups),
  },
  {
    title: 'Feature-slice isolation',
    universal: false,
    frameworks: ['react', 'vue', 'next'],
    status: (s) => groupsStatus(s.featureSlices.groups),
  },
  {
    title: 'App isolation',
    universal: false,
    frameworks: ['monorepo'],
    status: (s) => groupsStatus(s.appIsolation.groups),
  },
  {
    title: 'Workspace-package API',
    universal: false,
    frameworks: ['monorepo'],
    status: (s) =>
      gatedStatus(s.workspacePackageApi.consumerCount, s.workspacePackageApi.gate.status),
  },
  {
    title: 'Test isolation',
    universal: true,
    frameworks: [],
    status: (s) => gatedStatus(s.testIsolation.testFileCount, s.testIsolation.gate.status),
  },
  {
    title: 'Dependency hygiene (no build/impl internals)',
    universal: true,
    frameworks: [],
    status: (s) =>
      gatedStatus(s.dependencyInternals.externalImporterCount, s.dependencyInternals.gate.status),
  },
  {
    title: 'Dependency declaration (no phantom deps)',
    universal: true,
    frameworks: [],
    status: (s) =>
      gatedStatus(s.phantomDependencies.externalImporterCount, s.phantomDependencies.gate.status),
  },
  {
    title: 'Entry purity',
    universal: false,
    frameworks: ['next', 'remix', 'svelte', 'nuxt'],
    status: (s) => gatedStatus(s.entryPurity.entryCount, s.entryPurity.gate.status),
  },
  {
    title: 'Import style (aliases over deep relatives)',
    universal: true,
    frameworks: [],
    status: (s) => gatedStatus(s.deepRelative.relativeImporterCount, s.deepRelative.gate.status),
  },
  {
    title: 'Console isolation',
    universal: true,
    frameworks: [],
    status: (s) => gatedStatus(s.consoleIsolation.libraryFileCount, s.consoleIsolation.gate.status),
  },
  {
    title: 'Env access',
    universal: true,
    frameworks: [],
    status: (s) => gatedStatus(s.envAccess.envUserCount, s.envAccess.gate.status),
  },
  {
    title: 'Stories isolation',
    universal: false,
    frameworks: ['storybook'],
    status: (s) => gatedStatus(s.storiesIsolation.storyCount, s.storiesIsolation.gate.status),
  },
  {
    title: 'UI / data separation',
    universal: false,
    frameworks: ['react', 'vue'],
    status: (s) => gatedStatus(s.uiDataIsolation.componentCount, s.uiDataIsolation.gate.status),
  },
  {
    title: 'Server / client boundary',
    universal: false,
    frameworks: ['next'],
    status: (s) => gatedStatus(s.serverClient.clientCount, s.serverClient.gate.status),
  },
];

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function collectDeps(packageJsonPath: string, into: Set<string>): void {
  if (!existsSync(packageJsonPath)) return;
  try {
    const json = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
    for (const field of DEP_FIELDS) {
      const deps = json[field];
      if (deps && typeof deps === 'object') {
        for (const name of Object.keys(deps as Record<string, unknown>)) into.add(name);
      }
    }
  } catch {
    /* v8 ignore next -- unreadable/invalid package.json contributes no dependencies */
  }
}

export function detectStack(appDir: string): Set<string> {
  const root = path.resolve(appDir);
  const deps = new Set<string>();
  collectDeps(path.join(root, 'package.json'), deps);
  const workspaceRoot = findWorkspaceRoot(root);
  if (workspaceRoot !== root) collectDeps(path.join(workspaceRoot, 'package.json'), deps);

  const has = (name: string): boolean => deps.has(name);
  const some = (prefix: string): boolean => [...deps].some((d) => d.startsWith(prefix));
  const tokens = new Set<string>();
  if (has('next')) tokens.add('next');
  if (some('@nestjs/')) tokens.add('nest');
  if (has('@sveltejs/kit') || has('svelte')) tokens.add('svelte');
  if (has('nuxt')) tokens.add('nuxt');
  if (has('@remix-run/react') || has('@remix-run/node')) tokens.add('remix');
  if (has('react')) tokens.add('react');
  if (has('vue')) tokens.add('vue');
  if (some('@storybook/') || has('storybook')) tokens.add('storybook');
  if (Object.keys(buildWorkspacePackageMap(workspaceRoot)).length > 0) tokens.add('monorepo');
  return tokens;
}

export interface Recommendations {
  stack: string[];
  enforceNow: string[];
  review: string[];
  adopt: string[];
}

export function buildRecommendations(
  scan: ScanResult,
  stack: ReadonlySet<string>,
): Recommendations {
  const enforceNow: string[] = [];
  const review: string[] = [];
  const adopt: string[] = [];
  for (const family of FAMILIES) {
    const status = family.status(scan);
    if (status === 'AUTO') enforceNow.push(family.title);
    else if (status === 'SUGGEST') review.push(family.title);
    else if (family.universal || family.frameworks.some((f) => stack.has(f)))
      adopt.push(family.title);
  }
  return { stack: [...stack].sort(), enforceNow, review, adopt };
}
