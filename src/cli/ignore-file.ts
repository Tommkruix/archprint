import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const START = '# archprint:start';
const END = '# archprint:end';

function markerBlock(entry: string): string {
  return [START, entry, END].join('\n');
}

export function ensureIgnoreEntry(filePath: string, entry: string): boolean {
  const block = markerBlock(entry);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${block}\n`);
    return true;
  }
  const content = readFileSync(filePath, 'utf8');
  if (content.includes(START) || content.includes(END)) return false;
  const trimmed = content.replace(/\n+$/, '');
  writeFileSync(filePath, `${trimmed}\n\n${block}\n`);
  return true;
}

export function removeIgnoreEntry(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf8');
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start === -1 || end === -1 || end < start) return false;
  const without = (content.slice(0, start) + content.slice(end + END.length)).replace(
    /\n{3,}/g,
    '\n\n',
  );
  const trimmed = without.trim();
  writeFileSync(filePath, trimmed === '' ? '' : `${trimmed}\n`);
  return true;
}
