---
'archprint': minor
---

Add test isolation, a new rule family: production (non-test) code must not import test or spec files.
`detectTestIsolation` builds the import graph with test files kept as nodes (via a new `includeTests` option on
`buildImportGraph`), counts production files that import a test file, and runs the count through the Wilson
gate. Surfaced in the scan report (only when the app has test files), and `archprint generate` writes
`dependency-cruiser.test-isolation.archprint.json`, a `not-to-test` `forbidden` rule.
