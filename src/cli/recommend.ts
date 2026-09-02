import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ADOPTION_CATALOG } from '../data/adoption-catalog.js';
import type { GenerationStatus } from '../detector/confidence-gate.js';
import { type FamilyKey, isStableFamily } from '../detector/family-maturity.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from '../scanner/workspace-packages.js';
import type { ScanResult } from './scan.js';

type FamilyStatus = 'AUTO' | 'SUGGEST' | 'NONE';

// Recommend a not-yet-followed family for day-one adoption when at least this share of comparable repos
// (same stack, else overall) already AUTO-enforce it in the census. Below this the rule is too rare to push.
const ADOPT_THRESHOLD = 15;

interface Family {
  title: string;
  key: FamilyKey;
  status: (scan: ScanResult) => FamilyStatus;
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
    key: 'forbidden-imports',
    status: (s) => groupsStatus(s.patterns.map((p) => p.result)),
  },
  { title: 'Layer boundaries', key: 'layer', status: (s) => groupsStatus(s.layerBoundaries) },
  {
    title: 'Role layering',
    key: 'role-layering',
    status: (s) => groupsStatus(s.roleLayering.boundaries),
  },
  {
    title: 'Circular dependencies',
    key: 'cycles',
    status: (s) => gatedStatus(s.cycles.fileCount, s.cycles.gate.status),
  },
  {
    title: 'Public API (barrels)',
    key: 'public-api',
    status: (s) => groupsStatus(s.publicApi.groups),
  },
  {
    title: 'Feature-slice isolation',
    key: 'feature-slice',
    status: (s) => groupsStatus(s.featureSlices.groups),
  },
  {
    title: 'App isolation',
    key: 'app-isolation',
    status: (s) => groupsStatus(s.appIsolation.groups),
  },
  {
    title: 'Workspace-package API',
    key: 'workspace-package-api',
    status: (s) =>
      gatedStatus(s.workspacePackageApi.consumerCount, s.workspacePackageApi.gate.status),
  },
  {
    title: 'Test isolation',
    key: 'test-isolation',
    status: (s) => gatedStatus(s.testIsolation.testFileCount, s.testIsolation.gate.status),
  },
  {
    title: 'Dependency hygiene (no build/impl internals)',
    key: 'dependency-hygiene',
    status: (s) =>
      gatedStatus(s.dependencyInternals.externalImporterCount, s.dependencyInternals.gate.status),
  },
  {
    title: 'Dependency declaration (no phantom deps)',
    key: 'phantom-deps',
    status: (s) =>
      gatedStatus(s.phantomDependencies.externalImporterCount, s.phantomDependencies.gate.status),
  },
  {
    title: 'Entry purity',
    key: 'entry-purity',
    status: (s) => gatedStatus(s.entryPurity.entryCount, s.entryPurity.gate.status),
  },
  {
    title: 'Import style (aliases over deep relatives)',
    key: 'import-style',
    status: (s) => gatedStatus(s.deepRelative.relativeImporterCount, s.deepRelative.gate.status),
  },
  {
    title: 'Console isolation',
    key: 'console-isolation',
    status: (s) => gatedStatus(s.consoleIsolation.libraryFileCount, s.consoleIsolation.gate.status),
  },
  {
    title: 'Env access',
    key: 'env-access',
    status: (s) => gatedStatus(s.envAccess.subjectFileCount, s.envAccess.gate.status),
  },
  {
    title: 'Stories isolation',
    key: 'stories-isolation',
    status: (s) => gatedStatus(s.storiesIsolation.storyCount, s.storiesIsolation.gate.status),
  },
  {
    title: 'UI / data separation',
    key: 'ui-data',
    status: (s) => gatedStatus(s.uiDataIsolation.componentCount, s.uiDataIsolation.gate.status),
  },
  {
    title: 'Server / client boundary',
    key: 'server-client',
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

export interface Recommendation {
  title: string;
  // Census AUTO-adoption rate (%) among comparable repos: the best of the repo's detected stacks, else the
  // overall rate. null when the rate is not yet measured (e.g. a family whose detector was recently fixed).
  rate: number | null;
}

export interface Recommendations {
  stack: string[];
  evidence: { apps: number; asOf: string };
  enforceNow: Recommendation[];
  review: Recommendation[];
  adopt: Recommendation[];
}

// Best census AUTO rate for a family given the repo's stack: max over the detected stacks that the catalog
// covers, falling back to the overall rate. null = unmeasured (do not compare against the threshold).
function adoptionRate(title: string, stack: ReadonlySet<string>): number | null {
  const family = ADOPTION_CATALOG.families[title];
  if (!family || family.overall === null) return null;
  let best = family.overall;
  for (const token of stack) {
    const rate = family.byStack[token];
    if (rate != null && rate > best) best = rate;
  }
  return best;
}

export function buildRecommendations(
  scan: ScanResult,
  stack: ReadonlySet<string>,
): Recommendations {
  const enforceNow: Recommendation[] = [];
  const review: Recommendation[] = [];
  const adopt: Recommendation[] = [];
  for (const family of FAMILIES) {
    const status = family.status(scan);
    const entry: Recommendation = { title: family.title, rate: adoptionRate(family.title, stack) };
    // Only the audit-clean mechanical families go to enforce-now (which points at `archprint generate`);
    // a structural family's AUTO is capped at review, matching generate holding it back for a human pass.
    if (status === 'AUTO' && isStableFamily(family.key)) enforceNow.push(entry);
    else if (status === 'AUTO' || status === 'SUGGEST') review.push(entry);
    else if (entry.rate === null || entry.rate >= ADOPT_THRESHOLD) adopt.push(entry);
  }
  const byRate = (a: Recommendation, b: Recommendation): number =>
    (b.rate ?? -1) - (a.rate ?? -1) || a.title.localeCompare(b.title);
  enforceNow.sort(byRate);
  review.sort(byRate);
  adopt.sort(byRate);
  return {
    stack: [...stack].sort(),
    evidence: { apps: ADOPTION_CATALOG.meta.apps, asOf: ADOPTION_CATALOG.meta.asOf },
    enforceNow,
    review,
    adopt,
  };
}
