import { closeSync, existsSync, openSync, readSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { type ImportDeclaration, Project, type SourceFile, SyntaxKind } from 'ts-morph';
import { isBarrelFile, resolveToLeafFiles } from './barrel-resolver.js';
import {
  classifyFile,
  classifyFileWithDirective,
  hasUseServerDirective,
  type RoleClassification,
} from './role-classifier.js';
import { buildWorkspaceMap } from './workspace-resolver.js';
import { buildWorkspacePackageMap, findWorkspaceRoot } from './workspace-packages.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const SOURCE_FILE = /\.(ts|tsx)$/;

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

const DYNAMIC_FILE_CANDIDATES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

export function listSourceFiles(rootDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(path.join(dir, entry.name));
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

export function createImportAnalyzer(
  appDir: string,
  options: { resolve?: boolean } = {},
): (absoluteFilePath: string) => ResolvedImport[] {
  const resolve = options.resolve ?? true;
  const project = new Project(
    resolve
      ? { tsConfigFilePath: path.join(appDir, 'tsconfig.json'), skipAddingFilesFromTsConfig: true }
      : { skipAddingFilesFromTsConfig: true },
  );
  const aliases = Object.keys(buildWorkspaceMap(appDir));
  const workspacePackages = Object.keys(buildWorkspacePackageMap(findWorkspaceRoot(appDir)));

  const aliasDirs = Object.entries(buildWorkspaceMap(appDir)).map(([key, value]) => ({
    prefix: key.replace(/\/?\*$/, ''),
    dir: path.resolve(appDir, String(value).replace(/\/?\*$/, '')),
  }));
  const resolveDynamicFile = (specifier: string, containingFile: string): string | undefined => {
    let base: string | undefined;
    if (specifier.startsWith('.')) {
      base = path.resolve(path.dirname(containingFile), specifier);
    } else {
      for (const { prefix, dir } of aliasDirs) {
        if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
          base = path.resolve(dir, specifier.slice(prefix.length).replace(/^\//, ''));
          break;
        }
      }
    }
    if (base === undefined) return undefined;
    for (const suffix of DYNAMIC_FILE_CANDIDATES) {
      const candidate = base + suffix;
      if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
    }
    return undefined;
  };

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

  const matchesPrefix = (specifier: string, names: string[]): boolean =>
    names.some((name) => specifier === name || specifier.startsWith(name + '/'));

  const classifyEdge = (specifier: string, target: SourceFile | undefined): EdgeKind => {
    if (specifier.startsWith('.')) return 'relative';
    if (matchesPrefix(specifier, aliases)) return 'alias';
    if (matchesPrefix(specifier, workspacePackages)) return 'workspace';
    if (target === undefined) return 'unresolved';
    return target.getFilePath().includes('/node_modules/') ? 'external' : 'workspace';
  };

  return (absoluteFilePath: string): ResolvedImport[] => {
    const sourceFile = project.addSourceFileAtPath(absoluteFilePath);
    const results: ResolvedImport[] = sourceFile
      .getImportDeclarations()
      .map((importDeclaration) => {
        const specifier = importDeclaration.getModuleSpecifierValue();
        const hasValueBinding = importHasValueBinding(importDeclaration);
        if (!resolve) {
          return {
            specifier,
            edgeKind: classifyEdge(specifier, undefined),
            throughBarrel: false,
            valueLeafPaths: [],
            typeLeafPaths: [],
            hasValueBinding,
          };
        }
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
