// Which rule families are trustworthy enough to auto-emit as enforcement (AUTO), and which are held to
// human-reviewed SUGGEST until proven. The Phase A1 adversarial audit (ab/phase15/audit) found that EVERY
// false-AUTO came from the structural-inference families (layer, role-layering, entry-purity, ui-data,
// server-client, feature-slice, app-isolation, stories) whose "layer"/"role" is inferred from paths, while the
// mechanical/marker/graph-deterministic families had 0 false-AUTO across 148 audited rules in two rounds and
// four repos. env-access and workspace-package-api are held too (each had an UNCERTAIN), on the conservative
// bias that one wrong enforced rule hurts more than zero. As a structural family is hardened and re-audited
// clean, move it here.

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

// A stable family may auto-emit AUTO rules; a provisional family is capped at SUGGEST (human review) until it
// earns a clean audit record.
export const isStableFamily = (family: FamilyKey): boolean => STABLE_FAMILIES.has(family);
