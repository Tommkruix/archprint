import { closeSync, openSync, readSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { Project, type SourceFile } from 'ts-morph';
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
  /** Repo-relative path with POSIX separators (what the classifier matched on). */
  relativePath: string;
}

/** Where an import points, architecturally. Heuristic labels for the import graph. */
export type EdgeKind = 'relative' | 'alias' | 'workspace' | 'external' | 'unresolved';

export interface ResolvedImport {
  specifier: string;
  edgeKind: EdgeKind;
  /** True if the resolved target is a barrel we saw through. */
  throughBarrel: boolean;
  /** Leaf modules reached by value bindings, resolved at the symbol level (not every barrel export). */
  valueLeafPaths: string[];
  /** Leaf modules reached by `import type` bindings (erased at compile time). */
  typeLeafPaths: string[];
}

/**
 * Recursively list `.ts`/`.tsx` source files under a directory, skipping build/vendor and
 * dot-directories and `.d.ts` declarations. Pure filesystem walk (no parsing), so it stays fast
 * on large monorepos. Returns absolute paths.
 */
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

/** Read the first `bytes` of a file (enough to catch a leading `"use server"` directive). */
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

/**
 * Walk a directory and assign an architectural role to every source file. Path rules decide the
 * role; a file the path rules leave weakly classified is re-checked for a top-level `"use server"`
 * directive and upgraded to SERVER_ACTION, so server actions outside `app/**` are not missed.
 */
export function walkRepo(rootDir: string): WalkedFile[] {
  return listSourceFiles(rootDir).map((absolutePath) => {
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
    const base = classifyFile(relativePath);
    // Only `.ts` files the path rules left UNKNOWN can be a server-action module; `.tsx` pages that
    // carry a "use server" directive still render UI, so they stay COMPONENT (not a server entry).
    if (base.role === 'UNKNOWN' && !relativePath.endsWith('.tsx')) {
      let head: string;
      try {
        head = readHead(absolutePath);
      } catch {
        head = '';
      }
      if (hasUseServerDirective(head)) {
        return { absolutePath, relativePath, ...classifyFileWithDirective(relativePath, true) };
      }
    }
    return { absolutePath, relativePath, ...base };
  });
}

/** Import analyzer bound to one ts-morph Project; reuse across many files instead of one per file. */
export function createImportAnalyzer(
  appDir: string,
): (absoluteFilePath: string) => ResolvedImport[] {
  const project = new Project({
    tsConfigFilePath: path.join(appDir, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });
  const aliases = Object.keys(buildWorkspaceMap(appDir));
  const workspacePackages = Object.keys(buildWorkspacePackageMap(findWorkspaceRoot(appDir)));

  // exported name -> leaf files that define it, following re-exports.
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
      } catch {
        // type info unavailable (e.g. deps not installed); leave empty and fall back below
      }
      exportedLeafCache.set(key, map);
    }
    return map;
  };

  const matchesPrefix = (specifier: string, names: string[]): boolean =>
    names.some((name) => specifier === name || specifier.startsWith(name + '/'));

  const classifyEdge = (specifier: string, target: SourceFile | undefined): EdgeKind => {
    if (specifier.startsWith('.')) return 'relative';
    if (matchesPrefix(specifier, aliases)) return 'alias';
    // internal even when resolved via a node_modules symlink
    if (matchesPrefix(specifier, workspacePackages)) return 'workspace';
    if (target === undefined) return 'unresolved';
    return target.getFilePath().includes('/node_modules/') ? 'external' : 'workspace';
  };

  return (absoluteFilePath: string): ResolvedImport[] => {
    const sourceFile = project.addSourceFileAtPath(absoluteFilePath);
    return sourceFile.getImportDeclarations().map((importDeclaration) => {
      const specifier = importDeclaration.getModuleSpecifierValue();
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
        // Only barrels need the type checker to trace where a re-exported name is defined; a
        // non-barrel defines its own names, so the leaf is the target file itself.
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
        if (namespaceImport !== undefined || (named.length === 0 && defaultImport === undefined)) {
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
      };
    });
  };
}

/** Convenience: analyze a single file (creates a one-off analyzer bound to `appDir`). */
export function analyzeImports(appDir: string, absoluteFilePath: string): ResolvedImport[] {
  return createImportAnalyzer(appDir)(absoluteFilePath);
}
