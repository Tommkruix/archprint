import * as path from 'node:path';
import { type PropertyAccessExpression, Project, type SourceFile, SyntaxKind } from 'ts-morph';
import { walkRepo, type WalkedFile } from './file-walker.js';

export type UsageSubject = 'console' | 'process.env';

export interface FileUsage {
  usesConsole: boolean;
  usesProcessEnv: boolean;
  /** The line of each access, in source order. */
  lines: Record<UsageSubject, number[]>;
}

export interface UsageScan {
  root: string;
  files: WalkedFile[];
  usage: Map<string, FileUsage>;
}

function subjectOf(access: PropertyAccessExpression): UsageSubject | null {
  const target = access.getExpression();
  if (target.getKind() === SyntaxKind.Identifier && target.getText() === 'console')
    return 'console';
  if (access.getName() === 'env' && target.getText() === 'process') return 'process.env';
  return null;
}

/** The line of each `console.*` and `process.env` access in a file, in source order. */
function accessLines(sourceFile: SourceFile): Record<UsageSubject, number[]> {
  const lines: Record<UsageSubject, number[]> = { console: [], 'process.env': [] };
  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const subject = subjectOf(access);
    if (subject !== null) lines[subject].push(access.getStartLineNumber());
  }
  return lines;
}

export function usageLines(absolutePath: string, subject: UsageSubject): number[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  return accessLines(project.addSourceFileAtPath(absolutePath))[subject];
}

export function scanUsage(appDir: string): UsageScan {
  const root = path.resolve(appDir);
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const usage = new Map<string, FileUsage>();

  for (const file of files) {
    let lines: Record<UsageSubject, number[]> = { console: [], 'process.env': [] };
    try {
      const sourceFile = project.addSourceFileAtPath(file.absolutePath);
      lines = accessLines(sourceFile);
      project.removeSourceFile(sourceFile);
    } catch {
      /* v8 ignore next -- defensive: unreadable/malformed source contributes no usage */
    }
    usage.set(file.relativePath, {
      usesConsole: lines.console.length > 0,
      usesProcessEnv: lines['process.env'].length > 0,
      lines,
    });
  }

  return { root, files, usage };
}
