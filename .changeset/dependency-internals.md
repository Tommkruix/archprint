---
'archprint': minor
---

Add dependency hygiene, a new rule family covering external packages (the first detector that is not
first-party only): a file should import a third-party package by its public entry or a documented subpath, not
by reaching into its build/impl directories (`dist`, `src`, `lib`, `esm`, `cjs`, `build`, `out`, `internal`).
`detectDependencyInternals` counts files importing external packages and those reaching into internals, gates
with the Wilson floor, and `archprint generate` writes `dependency-cruiser.dependency-internals.archprint.json`.
