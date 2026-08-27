---
'archprint': minor
---

Add monorepo app isolation, a new rule family: sibling apps under an `apps`/`services` container must not
import each other directly (they should communicate through shared packages). `detectAppIsolation` gates
"apps under `<container>` must not import each other" with the Wilson floor, and `archprint generate` writes
`dependency-cruiser.app-isolation.archprint.json`, a `$1`-back-reference cross-app rule. The sibling-isolation
traversal and gating are now factored into a shared `detectSiblingIsolation` core used by both the
feature-slice and app-isolation detectors.
