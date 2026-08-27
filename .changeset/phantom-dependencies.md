---
'archprint': minor
---

Add phantom-dependency detection: every imported third-party package should be declared in package.json rather
than relied on transitively. `detectPhantomDependencies` collects the declared dependencies (the app's
package.json, the workspace root's, and all workspace package names) and flags imports of anything else, gated
by the Wilson floor. `archprint generate` writes `dependency-cruiser.phantom-deps.archprint.json` keyed on
dependency-cruiser's `npm-no-pkg` / `npm-unknown` dependency types.
