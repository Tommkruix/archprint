---
'archprint': minor
---

Add the pattern detector and confidence gate: `detectForbiddenImport` / `detectNoDbInRequestEntry`
infer a "role A must not import target B" boundary from the resolved import graph, and `evaluateGate`
decides AUTO / SUGGEST / REJECT against four conditions (ratio >= 90%, evidence >= 20 files,
exceptions <= 3, role confidence >= 80%). Markers match the import specifier and first-party leaves
only (never a dependency's internal `node_modules` folders). The file walker now classifies `.ts`
modules with a top-level `"use server"` directive as server actions.
