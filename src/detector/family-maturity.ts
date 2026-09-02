export type FamilyKey =
  | 'forbidden-imports'
  | 'layer'
  | 'role-layering'
  | 'cycles'
  | 'public-api'
  | 'feature-slice'
  | 'app-isolation'
  | 'workspace-package-api'
  | 'test-isolation'
  | 'dependency-hygiene'
  | 'phantom-deps'
  | 'entry-purity'
  | 'import-style'
  | 'console-isolation'
  | 'env-access'
  | 'stories-isolation'
  | 'ui-data'
  | 'server-client'
  | 'orphans'
  | 'reachability';

const STABLE_FAMILIES: ReadonlySet<FamilyKey> = new Set<FamilyKey>([
  'forbidden-imports',
  'cycles',
  'test-isolation',
  'console-isolation',
  'import-style',
  'phantom-deps',
  'public-api',
  'dependency-hygiene',
]);

export const isStableFamily = (family: FamilyKey): boolean => STABLE_FAMILIES.has(family);
