---
'archprint': minor
---

Monorepo-friendly `recommend`, `generate`, and `init`. `recommend` now discovers every app directory under a
monorepo root and reports per app (its `--json` output gains an `apps` array, matching `scan`). `generate` and
`init` automatically use the single app directory they find under a root, or, when a monorepo has several, list
the directories to point at instead of failing with a generic message.
