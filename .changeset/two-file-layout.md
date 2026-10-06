---
'archprint': minor
---

`.archprint/` is back to two files for a single linter: `config.json` and `eslint.mjs`. The adopted rules and the exceptions you allow with `archprint allow` now live in `config.json` (its `rules` and `allowed` lists) instead of `rules.json` and `allow.json`. Setups from 0.9.0 to 0.11.x keep working: `check` still reads `rules.json` and `allow.json`, including on a base branch that has them, and the next `archprint generate` moves both into `config.json` and deletes them. `check` also warns when a pull request removes the rules from `config.json`.
