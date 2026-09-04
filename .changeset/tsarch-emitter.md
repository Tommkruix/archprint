---
'archprint': minor
---

Emit architecture boundary tests for ts-arch. Alongside the ESLint and dependency-cruiser outputs, Archprint
now writes a ts-arch test file for the inferred first-party boundaries (layer, role, and UI/data), so you can
run them inside your existing Vitest or Jest suite.
