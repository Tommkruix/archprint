import type { SourceFile } from 'ts-morph';

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
