---
'archprint': patch
---

`.archprint/config.json` now records every rule written to `.archprint/eslint.mjs` or `.archprint/dependency-cruiser.json`. Env access, workspace-package API, role layering, feature slices, app isolation, stories isolation and UI/data separation were enforced but missing from the adopted rules, so `archprint check` did not report them and `archprint allow` refused them. The enforced, report-only and held-for-review lists in `config.json`, the `--readme` section and the `init` summary now follow the adopted rules: a held rule you adopt with `--rules` is listed as adopted, and a recommended rule you did not adopt is listed as report only rather than as adopted.

If your CI pins an archprint version (for example the GitHub Action's `archprint-version`), use 0.15.0 or later there too: an older `archprint check` stops with an error on a `config.json` that records these rules.
