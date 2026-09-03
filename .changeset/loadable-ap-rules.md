---
'archprint': minor
---

Make the flagship forbidden-import rules (AP-) loadable and enforceable (roadmap B7). `generate`/`init` now emit
a self-contained local eslint plugin (`eslint-plugin.archprint.mjs`) that implements each AUTO forbidden-import
rule faithfully to the detector (matches the import specifier, skips type-only imports, and only applies to files
whose path matches the rule's role). The eslint aggregator loads the plugin so a single wired reference activates
the rules, and they are removed cleanly on `eject`. An end-to-end test runs the real eslint engine and confirms a
server-entry route importing the UI layer is flagged while a clean route passes. Also fixes a wiring bug where a
single-line `export default []` config had its array closer swallowed by the inserted managed comment.
