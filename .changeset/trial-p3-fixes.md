---
'archprint': patch
---

- `generate` now counts every adopted rule it kept in "Kept N previously adopted rule(s)", including the default rules and the declared (`doc-`) rules; before, it counted only those outside the run's selection.
- `scan --json` (and the MCP scan tool) lists every dead-code file in each app's `deadCode`: `orphans` and `importedOnlyByTests`. The text report still shows the first 8, and now says that `scan --json` lists all.
- A CLAUDE.md sentence mapped with the `inferred` template to a rule the app has adopted is now recorded (in `stated` in `.archprint/config.json`) instead of refused with "adopt it with --rules", so `archprint check` counts it as checked. `check`'s note on a new rule-like sentence says so.
