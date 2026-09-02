---
'archprint': patch
---

Resolve bare `baseUrl`-relative imports as first-party. With an explicit tsconfig `baseUrl`, TypeScript
resolves a bare specifier like `import x from "app/foo"` or `"test/fixtures/x"` against baseUrl before
node_modules, but the resolver treated these as external and dropped them, undercounting real violations (a
false-AUTO source) and misreporting them as phantom dependencies. Each top-level directory under an explicit
baseUrl is now a first-party prefix. Surfaced by the Phase A1 re-audit on three monorepos.
