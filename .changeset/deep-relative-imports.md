---
'archprint': minor
---

Add import-style detection: prefer workspace aliases over deep relative imports (`../../../` and deeper).
`detectDeepRelativeImports` gates the rule with the Wilson floor over files that use relative imports, and
`archprint generate` writes `eslint.deep-relative.archprint.json`, an ESLint `no-restricted-imports` config,
Archprint's first ESLint-core output format.
