/**
 * Whether source text starts with a directive such as "use client", after a BOM, a shebang line, whitespace and
 * comments. Self-contained: the generated ESLint rules embed it.
 */
export function hasLeadingDirective(source: string, directive: string): boolean {
  const isWhitespace = (c: string): boolean =>
    c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (source.startsWith('#!', i)) {
    const newline = source.indexOf('\n', i);
    if (newline === -1) return false;
    i = newline + 1;
  }
  for (;;) {
    while (i < source.length && isWhitespace(source[i]!)) i++;
    if (source.startsWith('//', i)) {
      const newline = source.indexOf('\n', i);
      if (newline === -1) return false;
      i = newline + 1;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 2;
    } else {
      break;
    }
  }
  return new RegExp(`^["']${directive}["']`).test(source.slice(i));
}
