---
'archprint': minor
---

`archprint generate --remove <ids>` removes the adopted rules it names, without touching the others. Later runs of `generate` leave a removed rule out, even one the default rule set would adopt, until `--rules` (or `--declare`, for a rule your context files state) adopts it again; `--reset` returns to the default set. A removal is not blocked by new breaks of the rule being removed. When the sentence behind a declared rule is deleted, `generate` and `check` now point at `generate --remove <id>` instead of `--reset`, which removed every adopted rule.
