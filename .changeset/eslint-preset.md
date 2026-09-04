---
'archprint': minor
---

Generate a shareable ESLint preset. `archprint generate` now writes a single, self-contained
`eslint-preset.archprint.mjs` that inlines the inferred rules and needs only eslint, so you can commit it,
publish it, or hand it to another repository and adopt the rules in one line:
`import archprint from './eslint-preset.archprint.mjs'`.
