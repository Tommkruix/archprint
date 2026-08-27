---
'archprint': minor
---

Add workspace-package public-API detection: in a monorepo, a workspace package should be imported by its name
(which resolves to its entry), not by a deep path into its source. `detectWorkspacePackageApi` matches import
specifiers against the workspace package names, gates deep imports with the Wilson floor, and `archprint
generate` writes `eslint.workspace-package.archprint.json` (a `no-restricted-imports` rule over the package
names).
