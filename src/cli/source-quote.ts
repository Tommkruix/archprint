import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';

const MAX_SOURCE_BYTES = 1_000_000;

/** Typographic characters an agent may write for their plain forms, or the reverse. */
const PLAIN: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
};
const EMPHASIS = new Set(['*', '_', '`']);

/** Text without markdown emphasis, with plain quotes and dashes and single spaces, and the line of each character. */
function normalize(text: string): { text: string; lines: number[] } {
  let normalized = '';
  const lines: number[] = [];
  let line = 1;
  let space = false;
  for (const raw of text) {
    if (raw === '\n') line += 1;
    if (EMPHASIS.has(raw)) continue;
    if (/\s/.test(raw)) {
      space = normalized.length > 0;
      continue;
    }
    if (space) {
      normalized += ' ';
      lines.push(line);
      space = false;
    }
    normalized += PLAIN[raw] ?? raw;
    lines.push(line);
  }
  return { text: normalized, lines };
}

const isInside = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

export type QuoteLocation = { line: number } | { missing: string };

/**
 * The 1-based line where `quote` starts in `file` (relative to `root`), comparing text without markdown emphasis
 * and with whitespace collapsed. A file outside `root`, missing, or larger than 1 MB is reported, not read.
 */
export function locateQuote(root: string, file: string, quote: string): QuoteLocation {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, file);
  if (!isInside(absoluteRoot, absolute)) return { missing: `${file} is outside ${absoluteRoot}` };
  if (!existsSync(absolute)) return { missing: `${file} does not exist` };
  if (!isInside(realpathSync(absoluteRoot), realpathSync(absolute))) {
    return { missing: `${file} links outside ${absoluteRoot}` };
  }
  const stat = statSync(absolute);
  if (!stat.isFile()) return { missing: `${file} is not a file` };
  if (stat.size > MAX_SOURCE_BYTES) return { missing: `${file} is larger than 1 MB` };
  const source = normalize(readFileSync(absolute, 'utf8'));
  const index = source.text.indexOf(normalize(quote).text);
  return index === -1 ? { missing: `the quote is not in ${file}` } : { line: source.lines[index]! };
}
