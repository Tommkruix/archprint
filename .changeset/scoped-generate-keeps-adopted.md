---
'archprint': minor
---

`generate --only <family>` and `generate --rules <ids>` now add to the rules you adopted before instead of replacing them. Earlier, a scoped run kept only what it generated, so `--only layer` on a repo with no layer rules removed every adopted rule and `.archprint/eslint.mjs` with them. A scoped run now lists the rules it kept and names any earlier rule the current code no longer supports. A plain `archprint generate` still resets to the default rule set.
