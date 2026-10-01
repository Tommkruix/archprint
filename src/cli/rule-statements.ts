export const FAMILY_STATEMENTS = {
  cycles: 'modules must not import each other in a cycle',
  'test-isolation': 'production code must not import test files',
  'dependency-hygiene': 'import dependencies by their public entry, not their internals',
  'entry-purity': 'framework entries must not be imported by other code',
  'phantom-deps': 'import only packages declared in package.json',
  'import-style': 'prefer workspace aliases over deep relative imports',
  'console-isolation': 'library code must not use console',
  'env-access': 'read process.env only in the config layer',
  'workspace-package-api': 'import workspace packages by name, not a deep path',
  'stories-isolation': 'Storybook stories must not be imported by other code',
  'ui-data': 'UI components must not import the data layer directly',
  'server-client': '"use client" modules must not import server-only code',
} as const;

export type SingleFamily = keyof typeof FAMILY_STATEMENTS;

export const boundaryStatement = (from: string, to: string): string =>
  `${from} must not import ${to}`;

export const publicApiStatement = (dir: string): string =>
  `import ${dir} through its public entry (barrel), not its internal files`;

export const sliceStatement = (container: string): string =>
  `feature slices under ${container} must not import each other`;

export const appIsolationStatement = (container: string): string =>
  `apps under ${container} must not import each other`;
