import { readFileSync } from 'node:fs';
import * as path from 'node:path';

export interface CodeFrame {
  line: number;
  text: string;
}

export function locateImport(
  appDir: string,
  relativeFile: string,
  specifier: string,
): CodeFrame | null {
  let source: string;
  try {
    source = readFileSync(path.join(appDir, relativeFile), 'utf8');
  } catch {
    return null;
  }
  const single = `'${specifier}'`;
  const double = `"${specifier}"`;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!;
    if (text.includes(single) || text.includes(double)) {
      return { line: index + 1, text: text.trim() };
    }
  }
  return null;
}
