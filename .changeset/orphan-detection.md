---
'archprint': minor
---

Add orphan-module detection: `detectOrphans` finds first-party source files that no other file imports and
that are not framework or tooling entry points (routes, pages, layouts, middleware, config). These dead-code
candidates are surfaced in the scan report as an informational SUGGEST (never enforced), since dynamic or
string-based loading can make a live file look unreferenced. The cycle and orphan detectors now share a
single `buildImportGraph` builder so the first-party value-import graph is constructed one way.
