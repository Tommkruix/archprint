---
'archprint': minor
---

The MCP tools and `scan --json` now say what each rule means and which files break it. Every rule carries a plain-language `statement` (the same wording `archprint scan` prints) and an `exceptions` list naming the files that break it (up to 10; `violatingFiles` still has the full count). `archprint_explain` now explains any rule from the scan by its label, such as `env-access` or `lib !-> app`, not only the `AP-` rules, and returns every exception file. An agent can now answer "what rules does this repo follow?" accurately from a single scan, instead of guessing what a family name means.
