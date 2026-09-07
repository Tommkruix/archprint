---
'archprint': patch
---

Scan repositories that declare a TypeScript project but have few source files. Archprint now recognizes
`tsconfig.base.json` (not only `tsconfig.json`) and always scans a repo that has a tsconfig, instead of failing
with a "no scannable app directory" error on TypeScript-light repos.
