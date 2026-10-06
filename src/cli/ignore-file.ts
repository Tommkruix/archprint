import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { staysInsideItsFolder } from '../generator/owned-paths.js';
import { lineBreakAt, lineBreakBefore, lineBreakOf } from './line-breaks.js';

const START = '# archprint:start';
const END = '# archprint:end';

function markerBlock(entry: string, eol: string): string {
  return [START, entry, END].join(eol);
}

export type IgnoreResult = 'created' | 'appended' | 'present' | 'skipped';

export function ensureIgnoreEntry(
  filePath: string,
  entry: string,
  options: { create?: boolean } = {},
): IgnoreResult {
  if (!staysInsideItsFolder(filePath)) return 'skipped';
  if (!existsSync(filePath)) {
    if (options.create === false) return 'skipped';
    writeFileSync(filePath, `${markerBlock(entry, '\n')}\n`);
    return 'created';
  }
  const content = readFileSync(filePath, 'utf8');
  if (content.includes(START) || content.includes(END)) return 'present';
  const eol = lineBreakOf(content);
  writeFileSync(filePath, `${content}${eol}${markerBlock(entry, eol)}${eol}`);
  return 'appended';
}

export function removeIgnoreEntry(
  filePath: string,
  options: { deleteIfEmpty?: boolean } = {},
): boolean {
  if (!existsSync(filePath) || !staysInsideItsFolder(filePath)) return false;
  const content = readFileSync(filePath, 'utf8');
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start === -1 || end === -1 || end < start) return false;
  const blockEnd = end + END.length;
  const remaining =
    content.slice(0, start - lineBreakBefore(content, start)) +
    content.slice(blockEnd + lineBreakAt(content, blockEnd));
  if (remaining.trim() === '' && options.deleteIfEmpty) {
    rmSync(filePath, { force: true });
    return true;
  }
  writeFileSync(filePath, remaining);
  return true;
}
