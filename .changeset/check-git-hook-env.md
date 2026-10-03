---
'archprint': patch
---

`archprint check` now checks the repository it runs in even when started from a git hook. A hook sets variables such as `GIT_DIR` that point git at one repository; check used to inherit them and could compare against the wrong one.
