---
'archprint': patch
---

`archprint check` now reports when a pull request removes the adopted rules. If the change deletes `.archprint/rules.json` or `config.json` (or the whole `.archprint/` folder) that the base commit has, it warns and lists every rule that stops being checked, instead of saying it did not run. It still does not fail the job; the docs show how to require a code owner's review for such a change.
