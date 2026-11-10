---
'archprint': patch
---

archprint now resolves a tsconfig `paths` key whose `*` follows its prefix directly, such as `"@*": ["./src/*"]`, so `@components/button` is `src/components/button`. Imports written that way were unresolved before: the orphan list reported the files they import, and rules did not see those edges. Each folder and source file of the target becomes an alias, the way `baseUrl` folders already do; a key listed explicitly still wins, and a scoped package such as `@acme/ui` is unaffected unless a matching folder exists.
