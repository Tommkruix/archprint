---
'archprint': patch
---

Generated rules are now green-by-construction: a rule archprint says you "already follow" passes clean
when you wire it, instead of flagging code that was there all along. Emitted rules are scoped to exactly
the files the detector measured (test files and cli/config files are excluded, matching what the analysis
skips) and exempt the specific exceptions the confidence gate accepted. This covers the console,
environment-access, deep-relative-import, workspace-package, test-isolation, phantom-dependency, and
dependency-internals rules across both ESLint and dependency-cruiser. The ESLint import rules
(deep-relative, workspace, test) are also emitted as a single merged block so they no longer override one
another in flat config.
