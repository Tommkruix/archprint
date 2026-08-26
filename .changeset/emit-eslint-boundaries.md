---
'archprint': minor
---

`archprint generate` now also emits the inferred layer boundaries as an eslint-plugin-boundaries config
(`eslint-boundaries.archprint.json`): each layer becomes an element type, and each layer disallows the layers
it must not import. Alongside the dependency-cruiser output, the inferred rules can be enforced by whichever
tool a TypeScript team already uses.
