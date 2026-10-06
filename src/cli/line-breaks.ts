export const lineBreakOf = (content: string): string => (/\r\n/.test(content) ? '\r\n' : '\n');

/** Length of the line break that ends just before `index` (0, 1 or 2). */
export const lineBreakBefore = (content: string, index: number): number =>
  index >= 2 && content.startsWith('\r\n', index - 2) ? 2 : content[index - 1] === '\n' ? 1 : 0;

/** Length of the line break that starts at `index` (0, 1 or 2). */
export const lineBreakAt = (content: string, index: number): number =>
  content.startsWith('\r\n', index) ? 2 : content[index] === '\n' ? 1 : 0;
