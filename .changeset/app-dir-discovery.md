---
'archprint': minor
---

`archprint scan` now discovers app directories automatically. Pointed at a repo root, including a monorepo,
it finds each app or package that has its own tsconfig.json and enough of its own source, and scans each one,
rather than requiring you to point at a single app directory. Sub-packages below the size threshold are
skipped; single-app repos are unchanged.
