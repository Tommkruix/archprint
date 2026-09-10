---
'archprint': patch
---

More fixes so an "enforce now" rule cannot flag code it was mined from:

- The dependency-cruiser no-internals rule matches only the internals directories the analysis measures
  (src, internal, internals), not a package's normal dist/lib entry.
- The dependency-cruiser test-isolation rule recognizes the full set of test locations (test/spec/e2e
  suffixes and **tests**/e2e/cypress/... directories).
- Phantom (undeclared) dependency checking is emitted only for dependency-cruiser; the ESLint form is
  dropped because it flags test files and first-party path aliases the analysis excludes.
- `wire` no longer reports success on `export default someFactory()` where the rules would never apply.
- `generate --check` reports files it could not parse instead of calling them clean.
