import * as path from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';
import { walkRepo, type WalkedFile } from './file-walker.js';

export interface FileUsage {
  usesConsole: boolean;
  usesProcessEnv: boolean;
}

export interface UsageScan {
  root: string;
  files: WalkedFile[];
  usage: Map<string, FileUsage>;
}

export function scanUsage(appDir: string): UsageScan {
  const root = path.resolve(appDir);
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const usage = new Map<string, FileUsage>();

  for (const file of files) {
    let usesConsole = false;
    let usesProcessEnv = false;
    try {
      const sourceFile = project.addSourceFileAtPath(file.absolutePath);
      for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const target = access.getExpression();
        if (target.getKind() === SyntaxKind.Identifier && target.getText() === 'console') {
          usesConsole = true;
        }
        if (access.getName() === 'env' && target.getText() === 'process') usesProcessEnv = true;
      }
      project.removeSourceFile(sourceFile);
    } catch {
      /* v8 ignore next -- defensive: unreadable/malformed source contributes no usage */
    }
    usage.set(file.relativePath, { usesConsole, usesProcessEnv });
  }

  return { root, files, usage };
}
