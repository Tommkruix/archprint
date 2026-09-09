---
'archprint': minor
---

`archprint generate` gains finer output control: `--only <family>` emits a single rule family,
`--rules <ids>` emits only the named forbidden-import rule ids, and `--check` runs the generated
ESLint rules against your repo and reports whether they pass, so you can confirm before wiring.
