import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const START = '# archprint:start';
const END = '# archprint:end';

function markerBlock(entry: string): string {
  return [START, entry, END].join('\n');
}

export type IgnoreResult = 'created' | 'appended' | 'present' | 'skipped';

export function ensureIgnoreEntry(
  filePath: string,
  entry: string,
  options: { create?: boolean } = {},
): IgnoreResult {
  const block = markerBlock(entry);
  if (!existsSync(filePath)) {
    if (options.create === false) return 'skipped';
    writeFileSync(filePath, `${block}\n`);
    return 'created';
  }
  const content = readFileSync(filePath, 'utf8');
  if (content.includes(START) || content.includes(END)) return 'present';
  writeFileSync(filePath, `${content.replace(/\n+$/, '')}\n\n${block}\n`);
  return 'appended';
}

export function removeIgnoreEntry(
  filePath: string,
  options: { deleteIfEmpty?: boolean } = {},
): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf8');
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start === -1 || end === -1 || end < start) return false;
  const remaining = (content.slice(0, start) + content.slice(end + END.length)).trim();
  if (remaining === '' && options.deleteIfEmpty) {
    rmSync(filePath, { force: true });
    return true;
  }
  writeFileSync(filePath, remaining === '' ? '' : `${remaining}\n`);
  return true;
}
