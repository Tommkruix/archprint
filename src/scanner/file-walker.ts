import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { Project, type SourceFile } from 'ts-morph';
import { isBarrelFile, resolveToLeafFiles } from './barrel-resolver.js';
import { classifyFile, type RoleClassification } from './role-classifier.js';
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
  /**
   * Leaf modules reached by VALUE bindings (real runtime dependencies), resolved at the SYMBOL
   * level: only the leaf that actually defines each imported name, not every export of a barrel.
   * This is what boundary rules should count.
   */
  valueLeafPaths: string[];
  /** Leaf modules reached by TYPE-only bindings (`import type`), which are erased at compile time
   *  and are therefore NOT real runtime dependencies. Kept separate so rules can ignore them. */
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

/** Walk a directory and assign an architectural role to every source file. */
export function walkRepo(rootDir: string): WalkedFile[] {
  return listSourceFiles(rootDir).map((absolutePath) => {
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
    return { absolutePath, relativePath, ...classifyFile(relativePath) };
  });
}

/**
 * Resolve the imports of a single file, following barrels to their leaf modules. Uses the app's
 * tsconfig so workspace aliases resolve. Files are added on demand (the whole project is not
 * loaded), keeping this cheap for targeted analysis.
 */
export function analyzeImports(appDir: string, absoluteFilePath: string): ResolvedImport[] {
  const project = new Project({
    tsConfigFilePath: path.join(appDir, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFile = project.addSourceFileAtPath(absoluteFilePath);
  const aliases = Object.keys(buildWorkspaceMap(appDir));
  // Workspace-package names (e.g. @acme/db) are INTERNAL boundaries even though they resolve
  // through node_modules symlinks. tsconfig-path resolvers miss these; we label them correctly.
  const workspacePackages = Object.keys(buildWorkspacePackageMap(findWorkspaceRoot(appDir)));

  // Cache each target's export map (exported name -> the leaf files that actually define it,
  // following re-exports). This is the type checker doing symbol-level resolution for us.
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
    // A workspace-package import is internal even when it resolves via a node_modules symlink.
    if (matchesPrefix(specifier, workspacePackages)) return 'workspace';
    if (target === undefined) return 'unresolved';
    return target.getFilePath().includes('/node_modules/') ? 'external' : 'workspace';
  };

  return sourceFile.getImportDeclarations().map((importDeclaration) => {
    const specifier = importDeclaration.getModuleSpecifierValue();
    const target = importDeclaration.getModuleSpecifierSourceFile();
    const edgeKind = classifyEdge(specifier, target);
    const valueLeaves = new Set<string>();
    const typeLeaves = new Set<string>();

    if (target !== undefined) {
      const declarationIsTypeOnly = importDeclaration.isTypeOnly();
      const named = importDeclaration.getNamedImports();
      const namespaceImport = importDeclaration.getNamespaceImport();
      const defaultImport = importDeclaration.getDefaultImport();
      const exported = exportedLeaves(target);

      const attribute = (name: string, isTypeOnly: boolean): void => {
        const leaves = exported.get(name) ?? new Set([target.getFilePath()]);
        for (const leaf of leaves) (isTypeOnly ? typeLeaves : valueLeaves).add(leaf);
      };

      for (const namedImport of named) {
        attribute(namedImport.getName(), declarationIsTypeOnly || namedImport.isTypeOnly());
      }
      if (defaultImport !== undefined) {
        attribute('default', declarationIsTypeOnly);
      }
      // Namespace (`import * as x`) or side-effect (`import '...'`) touches the whole module.
      if (namespaceImport !== undefined || (named.length === 0 && defaultImport === undefined)) {
        const bucket = declarationIsTypeOnly ? typeLeaves : valueLeaves;
        for (const leaf of resolveToLeafFiles(target)) bucket.add(leaf.getFilePath());
      }
    }

    return {
      specifier,
      edgeKind,
      throughBarrel: target !== undefined && isBarrelFile(target),
      valueLeafPaths: [...valueLeaves],
      typeLeafPaths: [...typeLeaves],
    };
  });
}
