---
'archprint': minor
---

`archprint check` now reports how the recorded exceptions of your adopted rules stand: how many still break their rule, and which ones the change fixed, for example `Exceptions: 3 left, 1 fixed in this change.` It follows renamed files. When a fixed exception is still recorded in `.archprint/config.json`, it says to run `archprint generate` so the rule applies there too. The line also appears in the GitHub step summary, and the JSON output gains an `exceptions` field.
