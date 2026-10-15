/**
 * Which files the scan reads. Self-contained (no imports, no outer references): the generated ESLint layer rules
 * embed these functions so they check exactly the files the evidence came from.
 */

/** A folder the scan never enters: build output, dependencies, coverage, and dot-folders. */
export function isSkippedFolder(name: string): boolean {
  return ['node_modules', 'dist', 'build', 'coverage'].includes(name) || name.startsWith('.');
}

/** A source file the scan reads. */
export function isSourceFileName(name: string): boolean {
  return /\.(ts|tsx|vue|svelte)$/.test(name) && !name.endsWith('.d.ts');
}
