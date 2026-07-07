import type { SourceFile } from 'ts-morph';

/**
 * A "barrel" is a file that exists only to re-export other modules (e.g. an `index.ts` full of
 * `export * from './x'` / `export { y } from './y'`) and declares no local values of its own.
 * Detecting barrels lets us resolve an alias import to the real leaf modules behind it before
 * analyzing the import graph, so a boundary is not hidden behind an index file.
 */
export function isBarrelFile(sourceFile: SourceFile): boolean {
  const hasReExport = sourceFile
    .getExportDeclarations()
    .some((declaration) => declaration.getModuleSpecifier() !== undefined);
  if (!hasReExport) {
    return false;
  }
  // A file that also defines its own values is a real module, not a pure barrel.
  const declaresLocalValues =
    sourceFile.getFunctions().length > 0 ||
    sourceFile.getClasses().length > 0 ||
    sourceFile.getVariableStatements().length > 0 ||
    sourceFile.getEnums().length > 0;
  return !declaresLocalValues;
}

/**
 * Resolve a source file to its leaf (non-barrel) files, following re-export chains through
 * nested barrels. Cycles are guarded via `visited`; specifiers that do not resolve to a project
 * file (external packages, missing modules) are skipped. A non-barrel resolves to itself.
 */
export function resolveToLeafFiles(
  sourceFile: SourceFile,
  visited: Set<string> = new Set(),
): SourceFile[] {
  const filePath = sourceFile.getFilePath();
  if (visited.has(filePath)) {
    return [];
  }
  visited.add(filePath);

  if (!isBarrelFile(sourceFile)) {
    return [sourceFile];
  }

  const leaves: SourceFile[] = [];
  const seenLeafPaths = new Set<string>();
  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const target = exportDeclaration.getModuleSpecifierSourceFile();
    if (target === undefined) {
      continue;
    }
    for (const leaf of resolveToLeafFiles(target, visited)) {
      const leafPath = leaf.getFilePath();
      if (!seenLeafPaths.has(leafPath)) {
        seenLeafPaths.add(leafPath);
        leaves.push(leaf);
      }
    }
  }
  return leaves;
}
