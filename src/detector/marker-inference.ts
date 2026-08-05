import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { listSourceFiles, walkRepo, type WalkedFile } from '../scanner/file-walker.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from '../scanner/workspace-packages.js';

// Route groups `(group)`, dynamic segments `[param]`, and framework roots hold many pages but are not
// the shared UI layer.
const STRUCTURAL_SEGMENT = /^(\(.*\)|\[.*\]|app|pages|src|dist|build)$/;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = (filePath: string): string => filePath.replace(/\\/g, '/');

// Heuristic specifier extraction for inference signals only; the detector resolves the graph via AST.
function importSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  for (const match of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specifiers.add(match[1]!);
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)) specifiers.add(match[1]!);
  return [...specifiers];
}

export interface UiSegmentEvidence {
  segment: string;
  componentFiles: number;
  nonComponentFiles: number;
  specificity: number;
  coverage: number;
}

export interface InferredMarkers {
  markers: RegExp[];
  segments: string[];
  evidence: UiSegmentEvidence[];
}

// Tests and stories are scaffolding, not architecture. Excluding them keeps a component directory's purity
// from being diluted by colocated tests (which would otherwise sink the real UI layer below the specificity
// gate). `.d.ts` declarations are already dropped by the walker.
function isScaffolding(file: WalkedFile): boolean {
  return file.role === 'TEST' || /\.stories\.(ts|tsx)$/.test(file.relativePath);
}

/**
 * Infer this repo's UI-layer specifier marker from its own graph: among directories that are almost
 * exclusively components (specificity), the one holding the largest share of the repo's components
 * (coverage). Coverage selects the encompassing UI layer over both insular feature directories and
 * heavily-imported primitive sub-libraries (e.g. components/ui), which raw import fan-in wrongly favors.
 */
export function inferUiLayerMarkers(appDir: string): InferredMarkers {
  const files = walkRepo(appDir).filter((file) => !isScaffolding(file));
  const components = files.filter((file) => file.role === 'COMPONENT');
  const others = files.filter((file) => file.role !== 'COMPONENT');
  if (components.length < 5) return { markers: [], segments: [], evidence: [] };

  const directorySegments = (relativePath: string): string[] => [
    ...new Set(relativePath.split('/').slice(0, -1)),
  ];
  const componentHits = new Map<string, number>();
  const otherHits = new Map<string, number>();
  for (const file of components) {
    for (const segment of directorySegments(file.relativePath)) {
      componentHits.set(segment, (componentHits.get(segment) ?? 0) + 1);
    }
  }
  for (const file of others) {
    for (const segment of directorySegments(file.relativePath)) {
      otherHits.set(segment, (otherHits.get(segment) ?? 0) + 1);
    }
  }

  const candidates = [...componentHits.entries()]
    .map(([segment, componentFiles]) => {
      const nonComponentFiles = otherHits.get(segment) ?? 0;
      return {
        segment,
        componentFiles,
        nonComponentFiles,
        specificity: componentFiles / (componentFiles + nonComponentFiles),
        coverage: componentFiles / components.length,
      };
    })
    .filter(
      (entry) =>
        entry.componentFiles >= 3 &&
        entry.specificity >= 0.85 &&
        !STRUCTURAL_SEGMENT.test(entry.segment) &&
        !entry.segment.includes('.'),
    )
    .sort((a, b) => b.coverage * b.specificity - a.coverage * a.specificity);
  if (candidates.length === 0) return { markers: [], segments: [], evidence: [] };

  const top = candidates[0]!;
  const segments = [top.segment];
  const markers = segments.map((segment) => new RegExp(`(^|/)${escapeRegExp(segment)}(/|$)`));
  return { markers, segments, evidence: candidates.slice(0, 8) };
}

/** Known database-client libraries: package-level vocabulary, not a per-repo convention. */
export const KNOWN_DB_LIBRARIES: readonly RegExp[] = [
  /@prisma\/(client|adapter-)/,
  /drizzle-orm/,
  /(^|\/)typeorm(\/|$)/,
  /(^|\/)mongoose(\/|$)/,
  /(^|\/)sequelize(\/|$)/,
  /@mikro-orm\//,
  /(^|\/)kysely(\/|$)/,
  /(^|\/)mongodb(\/|$)/,
  /(^|\/)pg(\/|$)/,
  /(^|\/)postgres(\/|$)/,
  /(^|\/)mysql2(\/|$)/,
  /@planetscale\/database/,
  /@neondatabase\/serverless/,
  /better-sqlite3/,
];

// Unambiguous ORM client constructors: a file containing one is a db wrapper.
const DB_CLIENT_CONSTRUCTOR =
  /new PrismaClient\s*\(|\bdrizzle\s*\(|new DataSource\s*\(|new Sequelize\s*\(|new Kysely\s*\(|MikroORM\.init\s*\(|mongoose\.(connect|createConnection)\s*\(/;

// Generic pool/driver constructors (pg, mysql, postgres.js). These also match non-db clients, so a file
// is only a wrapper when it ALSO imports a known db library.
const DB_CLIENT_CONSTRUCTOR_GENERIC =
  /new Pool\s*\(|new Client\s*\(|\bpostgres\s*\(|create(Pool|Connection)\s*\(|new Database\s*\(/;

const DB_TOKENS = [
  'prisma',
  'drizzle',
  'typeorm',
  'mongoose',
  'sequelize',
  'mikro-orm',
  'kysely',
  'mongodb',
  'better-sqlite3',
  'planetscale',
  'neondatabase',
  'new Pool',
  'postgres',
  'mysql2',
];

export interface InferredDbMarkers {
  markers: RegExp[];
  libraries: RegExp[];
  wrappers: string[];
}

/** Reverse-map a first-party file to the specifier importers use for it (workspace package or alias). */
function importableSpecifier(
  absFile: string,
  aliases: [string, string][],
  packages: [string, string][],
  appRoot: string,
): string | null {
  const file = normalize(absFile);
  const noExtension = file.replace(/\.(ts|tsx)$/, '').replace(/\/index$/, '');
  let best: { spec: string; length: number } | null = null;
  for (const [pkg, dir] of packages) {
    const target = normalize(path.resolve(dir));
    if (target === appRoot) continue; // the app's own package: internal files import via the alias
    if (file === target || file.startsWith(`${target}/`)) {
      if (!best || target.length > best.length) best = { spec: pkg, length: target.length };
    }
  }
  for (const [alias, dir] of aliases) {
    const target = normalize(path.resolve(dir));
    if (target.includes('/node_modules/')) continue;
    if (noExtension === target || noExtension.startsWith(`${target}/`)) {
      const relative = noExtension.slice(target.length).replace(/^\//, '');
      const spec = relative ? `${alias}/${relative}` : alias;
      if (!best || target.length > best.length) best = { spec, length: target.length };
    }
  }
  return best ? best.spec : null;
}

/**
 * Infer this repo's db-client markers: the known libraries plus first-party wrappers that instantiate a
 * client. Each wrapper yields a specifier marker (direct imports) and a leaf-path marker (so barrel
 * re-exports are caught once the detector resolves the barrel to the wrapper file).
 */
export function inferDbClientMarkers(appDir: string): InferredDbMarkers {
  const appRoot = normalize(path.resolve(appDir));
  const repoRoot = normalize(path.resolve(findWorkspaceRoot(appDir)));
  const aliases = Object.entries(buildWorkspaceMap(appDir));
  const packages = Object.entries(buildWorkspacePackageMap(findWorkspaceRoot(appDir)));

  // The db client may be instantiated in a sibling workspace package, so scan the app and every package.
  const scanRoots = [
    appRoot,
    ...packages.map(([, dir]) => normalize(path.resolve(dir))).filter((dir) => dir !== appRoot),
  ];
  const scanned = new Set<string>();
  for (const root of scanRoots) {
    try {
      for (const file of listSourceFiles(root)) scanned.add(file);
    } catch {
      // package dir missing or unreadable; skip
    }
  }

  const wrapperFiles: string[] = [];
  for (const file of scanned) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      /* v8 ignore next -- defensive: file listed by the walker but unreadable */
      continue;
    }
    if (!DB_TOKENS.some((token) => text.includes(token))) continue;
    if (DB_CLIENT_CONSTRUCTOR.test(text)) {
      wrapperFiles.push(file);
    } else if (
      DB_CLIENT_CONSTRUCTOR_GENERIC.test(text) &&
      importSpecifiers(text).some((specifier) =>
        KNOWN_DB_LIBRARIES.some((lib) => lib.test(specifier)),
      )
    ) {
      wrapperFiles.push(file);
    }
  }

  const wrappers = new Set<string>();
  const wrapperMarkers: RegExp[] = [];
  for (const file of wrapperFiles) {
    const abs = normalize(path.resolve(file));
    const specifier = importableSpecifier(abs, aliases, packages, appRoot);
    if (specifier) {
      wrappers.add(specifier);
      wrapperMarkers.push(new RegExp(`${escapeRegExp(specifier)}($|[/.-])`));
    }
    // Leaf-path marker: matches the wrapper's resolved leaf path, so a barrel import that the detector
    // resolves to this file is flagged even though its specifier differs.
    if (abs.startsWith(`${repoRoot}/`)) {
      const relative = abs.slice(repoRoot.length + 1).replace(/\.(ts|tsx)$/, '');
      wrapperMarkers.push(new RegExp(`(^|/)${escapeRegExp(relative)}($|[/.-])`));
    }
  }

  return {
    markers: [...KNOWN_DB_LIBRARIES, ...wrapperMarkers],
    libraries: [...KNOWN_DB_LIBRARIES],
    wrappers: [...wrappers],
  };
}
