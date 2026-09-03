---
'archprint': minor
---

Generalize `wire`/`eject` across the enforcement tools a repo uses, not just eslint. Wiring is now a tool
registry: `wire` detects each supported tool's config and inserts a managed, reversible reference into every one
it finds, and `eject` removes them all. Dependency-cruiser is now supported: `generate`/`init` emit an aggregated
`dependency-cruiser.all.archprint.json` (merging the individual forbidden-rule sets, refreshed on every
regeneration), and `wire` adds a managed `extends` to a `.dependency-cruiser.json`, preserving the rest of the
config and removing exactly that entry on eject. A tool config that cannot be edited safely (a JS
dependency-cruiser config) gets the exact snippet printed instead. Adding a future tool is now a single registry
entry.
