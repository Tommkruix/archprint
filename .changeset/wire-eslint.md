---
'archprint': minor
---

Add `archprint wire` to reference the generated eslint rules from your flat eslint config (roadmap B6, part 2).
`generate`/`init` now also emit an aggregator (`eslint.archprint.mjs`) that globs archprint's eslint rule blocks,
so the reference is one stable line that survives regeneration (new rules are picked up, dropped ones disappear,
without re-wiring). `wire` inserts a MANAGED, reversible block (a marked import + one spread) into a flat
`eslint.config.{js,mjs,cjs}` when it can detect the array-form export, is idempotent, supports `--dry-run`, and
prints the exact snippet to paste for any other shape. `eject` now also removes that managed reference, restoring
the config exactly. Scope note: this wires the eslint built-in-rule blocks; the layer rules (eslint-plugin-
boundaries), the AP- custom rules, and the dependency-cruiser configs still target their own tools.
