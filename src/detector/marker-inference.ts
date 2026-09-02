import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ts } from 'ts-morph';
import { listSourceFiles, walkRepo, type WalkedFile } from '../scanner/file-walker.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from '../scanner/workspace-packages.js';

const STRUCTURAL_SEGMENT = /^(\(.*\)|\[.*\]|app|pages|src|dist|build)$/;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = (filePath: string): string => filePath.replace(/\\/g, '/');

function importSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  for (const match of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specifiers.add(match[1]!);
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)) specifiers.add(match[1]!);
  return [...specifiers];
}

function reexportSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  for (const match of text.matchAll(/\bexport\b([^;]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    if (/^\s+type\b/.test(match[1]!)) continue;
    specifiers.add(match[2]!);
  }
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

function isScaffolding(file: WalkedFile): boolean {
  return file.role === 'TEST' || /\.stories\.(ts|tsx)$/.test(file.relativePath);
}

function isCreateElementCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : '';
  return name === 'createElement' || name === 'cloneElement';
}

function rendersJsx(absolutePath: string): boolean {
  let text: string;
  try {
    text = readFileSync(absolutePath, 'utf8');
  } catch {
    /* v8 ignore next -- defensive: file listed by the walker but unreadable */
    return false;
  }
  const isTsx = absolutePath.endsWith('.tsx');
  if (!isTsx && !text.includes('createElement') && !text.includes('cloneElement')) return false;
  const source = ts.createSourceFile(
    absolutePath,
    text,
    ts.ScriptTarget.Latest,
    false,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      node.kind === ts.SyntaxKind.JsxElement ||
      node.kind === ts.SyntaxKind.JsxFragment ||
      node.kind === ts.SyntaxKind.JsxSelfClosingElement ||
      (ts.isCallExpression(node) && isCreateElementCall(node))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function isUiComponent(file: WalkedFile): boolean {
  return (file.role === 'COMPONENT' || file.role === 'UNKNOWN') && rendersJsx(file.absolutePath);
}

export function inferUiLayerMarkers(appDir: string): InferredMarkers {
  const files = walkRepo(appDir).filter((file) => !isScaffolding(file));
  const components = files.filter(isUiComponent);
  const componentSet = new Set(components);
  const others = files.filter((file) => !componentSet.has(file));
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

const DB_CLIENT_CONSTRUCTOR =
  /new PrismaClient\s*\(|\bdrizzle\s*\(|new DataSource\s*\(|new Sequelize\s*\(|new Kysely\s*\(|MikroORM\.init\s*\(|mongoose\.(connect|createConnection)\s*\(/;

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
    if (target === appRoot) continue;
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

export function inferDbClientMarkers(appDir: string): InferredDbMarkers {
  const appRoot = normalize(path.resolve(appDir));
  const repoRoot = normalize(path.resolve(findWorkspaceRoot(appDir)));
  const aliases = Object.entries(buildWorkspaceMap(appDir));
  const packages = Object.entries(buildWorkspacePackageMap(findWorkspaceRoot(appDir)));

  const scanRoots = [
    appRoot,
    ...packages.map(([, dir]) => normalize(path.resolve(dir))).filter((dir) => dir !== appRoot),
  ];
  const scanned = new Set<string>();
  for (const root of scanRoots) {
    try {
      for (const file of listSourceFiles(root)) scanned.add(file);
    } catch {}
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
    } else if (
      reexportSpecifiers(text).some((specifier) =>
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
