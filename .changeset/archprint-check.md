---
'archprint': minor
---

Add `archprint check`, which reports only the violations a change introduces, compared with a base branch or commit, for the rules your team adopted with `init` or `generate`. It works in any CI. On GitHub, `--format github` shows each finding inline on the pull request, with its evidence, plus a step summary that also counts the violations the change fixed. It warns by default; `--fail-on new` fails the job so you can make it a required status check. `--format json` and exit codes (`0` ok, `1` new violations, `2` the CI setup is wrong) cover other CI systems.

`init` and `generate` now also write `.archprint/rules.json`, the exact definition of each adopted mechanical rule, which `check` uses so it never re-infers a rule. If you set up archprint with 0.8.x or earlier, run `archprint generate` once; until then `check` reports that it did not run.
