---
'archprint': patch
---

Make deep scans dramatically faster on real repositories by not loading `node_modules` into the analysis. Deep resolution now resolves first-party imports (including `baseUrl` and `paths`) and workspace packages, but skips pulling external dependencies into the TypeScript program, and caches module resolution. A single large app drops from about 5 minutes to under 20 seconds and a 14-app monorepo from over 30 minutes to about 2 minutes, with byte-identical results, so `generate` is now practical on large codebases.
