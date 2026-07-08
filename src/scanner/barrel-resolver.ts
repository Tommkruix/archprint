import type { SourceFile } from 'ts-morph';

/** A file that only re-exports other modules (`export * from './x'`) and declares no values. */
export function isBarrelFile(sourceFile: SourceFile): boolean {
  const hasReExport = sourceFile
    .getExportDeclarations()
    .some((declaration) => declaration.getModuleSpecifier() !== undefined);
  if (!hasReExport) {
    return false;
  }
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
