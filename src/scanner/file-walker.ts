import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { type ImportDeclaration, Project, type SourceFile, SyntaxKind } from 'ts-morph';
import * as ts from 'typescript';
import { isBarrelFile, resolveToLeafFiles } from './barrel-resolver.js';
import {
  classifyFile,
  classifyFileWithDirective,
  hasUseServerDirective,
  type RoleClassification,
} from './role-classifier.js';
import { buildWorkspaceMap } from './workspace-resolver.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from './workspace-packages.js';
import { createIgnoreFilter } from './ignore-filter.js';
import { resolveFirstPartyImport } from './resolve-import.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const SOURCE_FILE = /\.(ts|tsx|vue|svelte)$/;

const SFC_SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const isSingleFileComponent = (filePath: string): boolean =>
  filePath.endsWith('.vue') || filePath.endsWith('.svelte');

function parseableSource(
  absoluteFilePath: string,
  text: string,
): { source: string; scriptKind: ts.ScriptKind } {
  if (isSingleFileComponent(absoluteFilePath)) {
    const blocks = [...text.matchAll(SFC_SCRIPT)].map((match) => match[1] ?? '');
    return { source: blocks.join('\n'), scriptKind: ts.ScriptKind.TS };
  }
  return {
    source: text,
    scriptKind: absoluteFilePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  };
}

export interface WalkedFile extends RoleClassification {
  absolutePath: string;
  relativePath: string;
}

export type EdgeKind = 'relative' | 'alias' | 'workspace' | 'external' | 'unresolved';

export interface ResolvedImport {
  specifier: string;
  edgeKind: EdgeKind;
  throughBarrel: boolean;
  valueLeafPaths: string[];
  typeLeafPaths: string[];
  hasValueBinding: boolean;
}

function importHasValueBinding(importDeclaration: ImportDeclaration): boolean {
  if (importDeclaration.isTypeOnly()) return false;
  const named = importDeclaration.getNamedImports();
  const hasValueNamed = named.some((namedImport) => !namedImport.isTypeOnly());
  const hasDefault = importDeclaration.getDefaultImport() !== undefined;
  const hasNamespace = importDeclaration.getNamespaceImport() !== undefined;
  const sideEffectOnly = named.length === 0 && !hasDefault && !hasNamespace;
  return hasValueNamed || hasDefault || hasNamespace || sideEffectOnly;
}

function dynamicImportSpecifiers(sourceFile: SourceFile): string[] {
  const specifiers: string[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const argument = call.getArguments()[0]?.asKind(SyntaxKind.StringLiteral);
    if (argument !== undefined) specifiers.push(argument.getLiteralValue());
  }
  return specifiers;
}

export function listSourceFiles(rootDir: string): string[] {
  const files: string[] = [];
  const isIgnored = createIgnoreFilter(rootDir);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          !SKIP_DIRS.has(entry.name) &&
          !entry.name.startsWith('.') &&
          !isIgnored(path.relative(rootDir, full), true)
        ) {
          walk(full);
        }
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        if (!isIgnored(path.relative(rootDir, full), false)) files.push(full);
      }
    }
  };
  walk(rootDir);
  return files;
}

function readHead(file: string, bytes = 512): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const read = readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf8', 0, read);
  } finally {
    closeSync(fd);
  }
}

export function walkRepo(rootDir: string): WalkedFile[] {
  return listSourceFiles(rootDir).map((absolutePath) => {
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
    const base = classifyFile(relativePath);
    if (base.role === 'UNKNOWN' && !relativePath.endsWith('.tsx')) {
      let head: string;
      try {
        head = readHead(absolutePath);
      } catch {
        /* v8 ignore next -- defensive: unreadable file head */
        head = '';
      }
      if (hasUseServerDirective(head)) {
        return { absolutePath, relativePath, ...classifyFileWithDirective(relativePath, true) };
      }
    }
    return { absolutePath, relativePath, ...base };
  });
}

function nodeHasValueBinding(clause: ts.ImportClause | undefined): boolean {
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  const hasDefault = clause.name !== undefined;
  const bindings = clause.namedBindings;
  const hasNamespace = bindings !== undefined && ts.isNamespaceImport(bindings);
  const named = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : [];
  const hasValueNamed = named.some((element) => !element.isTypeOnly);
  const sideEffectOnly = named.length === 0 && !hasDefault && !hasNamespace;
  return hasValueNamed || hasDefault || hasNamespace || sideEffectOnly;
}

interface RawImport {
  specifier: string;
  hasValueBinding: boolean;
}

const fastParseCache = new Map<string, { mtimeMs: number; size: number; raw: RawImport[] }>();
const FAST_PARSE_CACHE_CAP = 50000;

function parseFastImports(absoluteFilePath: string): RawImport[] {
  const stat = statSync(absoluteFilePath);
  const cached = fastParseCache.get(absoluteFilePath);
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.raw;
  }
  const { source, scriptKind } = parseableSource(
    absoluteFilePath,
    readFileSync(absoluteFilePath, 'utf8'),
  );
  const sourceFile = ts.createSourceFile(
    absoluteFilePath,
    source,
    ts.ScriptTarget.Latest,
    false,
    scriptKind,
  );
  const raw: RawImport[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      raw.push({
        specifier: statement.moduleSpecifier.text,
        hasValueBinding: nodeHasValueBinding(statement.importClause),
      });
    }
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      raw.push({ specifier: node.arguments[0].text, hasValueBinding: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (fastParseCache.size >= FAST_PARSE_CACHE_CAP) fastParseCache.clear();
  fastParseCache.set(absoluteFilePath, { mtimeMs: stat.mtimeMs, size: stat.size, raw });
  return raw;
}

function specifierLevelImports(
  absoluteFilePath: string,
  classifyEdge: (specifier: string) => EdgeKind,
): ResolvedImport[] {
  return parseFastImports(absoluteFilePath).map((imp) => ({
    specifier: imp.specifier,
    edgeKind: classifyEdge(imp.specifier),
    throughBarrel: false,
    valueLeafPaths: [],
    typeLeafPaths: [],
    hasValueBinding: imp.hasValueBinding,
  }));
}

function createFastImportAnalyzer(
  classifyEdge: (specifier: string) => EdgeKind,
): (absoluteFilePath: string) => ResolvedImport[] {
  return (absoluteFilePath: string): ResolvedImport[] =>
    specifierLevelImports(absoluteFilePath, classifyEdge);
}

export function createImportAnalyzer(
  appDir: string,
  options: { resolve?: boolean } = {},
): (absoluteFilePath: string) => ResolvedImport[] {
  const resolve = options.resolve ?? true;
  const aliases = Object.keys(buildWorkspaceMap(appDir));
  const workspacePackages = Object.keys(buildWorkspacePackageMap(findWorkspaceRoot(appDir)));

  const matchesPrefix = (specifier: string, names: string[]): boolean =>
    names.some((name) => specifier === name || specifier.startsWith(name + '/'));

  const classifyEdge = (specifier: string, target: SourceFile | undefined): EdgeKind => {
    if (specifier.startsWith('.')) return 'relative';
    if (matchesPrefix(specifier, aliases)) return 'alias';
    if (matchesPrefix(specifier, workspacePackages)) return 'workspace';
    if (target === undefined) return 'unresolved';
    return target.getFilePath().includes('/node_modules/') ? 'external' : 'workspace';
  };

  if (!resolve) {
    return createFastImportAnalyzer((specifier) => classifyEdge(specifier, undefined));
  }

  const project = new Project({
    tsConfigFilePath: path.join(appDir, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });
  const aliasDirs = Object.entries(buildWorkspaceMap(appDir)).map(([key, value]) => ({
    prefix: key.replace(/\/?\*$/, ''),
    dir: path.resolve(appDir, String(value).replace(/\/?\*$/, '')),
  }));
  const resolveDynamicFile = (specifier: string, containingFile: string): string | undefined =>
    resolveFirstPartyImport(specifier, containingFile, aliasDirs) ?? undefined;

  const exportedLeafCache = new Map<string, Map<string, Set<string>>>();
  const exportedLeaves = (target: SourceFile): Map<string, Set<string>> => {
    const key = target.getFilePath();
    let map = exportedLeafCache.get(key);
    if (map === undefined) {
      map = new Map();
      try {
        for (const [name, declarations] of target.getExportedDeclarations()) {
          map.set(name, new Set(declarations.map((d) => d.getSourceFile().getFilePath())));
        }
      } catch {}
      exportedLeafCache.set(key, map);
    }
    return map;
  };

  return (absoluteFilePath: string): ResolvedImport[] => {
    if (isSingleFileComponent(absoluteFilePath)) {
      return specifierLevelImports(absoluteFilePath, (specifier) =>
        classifyEdge(specifier, undefined),
      );
    }
    const sourceFile = project.addSourceFileAtPath(absoluteFilePath);
    const results: ResolvedImport[] = sourceFile
      .getImportDeclarations()
      .map((importDeclaration) => {
        const specifier = importDeclaration.getModuleSpecifierValue();
        const hasValueBinding = importHasValueBinding(importDeclaration);
        const target = importDeclaration.getModuleSpecifierSourceFile();
        const edgeKind = classifyEdge(specifier, target);
        const throughBarrel = target !== undefined && isBarrelFile(target);
        const valueLeaves = new Set<string>();
        const typeLeaves = new Set<string>();

        if (target !== undefined) {
          const declarationIsTypeOnly = importDeclaration.isTypeOnly();
          const named = importDeclaration.getNamedImports();
          const namespaceImport = importDeclaration.getNamespaceImport();
          const defaultImport = importDeclaration.getDefaultImport();
          const exported = throughBarrel ? exportedLeaves(target) : null;

          const attribute = (name: string, isTypeOnly: boolean): void => {
            const leaves = exported?.get(name) ?? new Set([target.getFilePath()]);
            for (const leaf of leaves) (isTypeOnly ? typeLeaves : valueLeaves).add(leaf);
          };

          for (const namedImport of named) {
            attribute(namedImport.getName(), declarationIsTypeOnly || namedImport.isTypeOnly());
          }
          if (defaultImport !== undefined) {
            attribute('default', declarationIsTypeOnly);
          }
          if (
            namespaceImport !== undefined ||
            (named.length === 0 && defaultImport === undefined)
          ) {
            const bucket = declarationIsTypeOnly ? typeLeaves : valueLeaves;
            if (throughBarrel) {
              for (const leaf of resolveToLeafFiles(target)) bucket.add(leaf.getFilePath());
            } else {
              bucket.add(target.getFilePath());
            }
          }
        }

        return {
          specifier,
          edgeKind,
          throughBarrel,
          valueLeafPaths: [...valueLeaves],
          typeLeafPaths: [...typeLeaves],
          hasValueBinding,
        };
      });

    for (const specifier of dynamicImportSpecifiers(sourceFile)) {
      let target: SourceFile | undefined;
      if (resolve) {
        const file = resolveDynamicFile(specifier, absoluteFilePath);
        target =
          file === undefined ? undefined : (project.addSourceFileAtPathIfExists(file) ?? undefined);
      }
      const throughBarrel = target !== undefined && isBarrelFile(target);
      const valueLeaves = new Set<string>();
      if (target !== undefined) {
        if (throughBarrel) {
          for (const leaf of resolveToLeafFiles(target)) valueLeaves.add(leaf.getFilePath());
        } else {
          valueLeaves.add(target.getFilePath());
        }
      }
      results.push({
        specifier,
        edgeKind: classifyEdge(specifier, target),
        throughBarrel,
        valueLeafPaths: [...valueLeaves],
        typeLeafPaths: [],
        hasValueBinding: true,
      });
    }
    return results;
  };
}

export function analyzeImports(appDir: string, absoluteFilePath: string): ResolvedImport[] {
  return createImportAnalyzer(appDir)(absoluteFilePath);
}
