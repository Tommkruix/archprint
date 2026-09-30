---
'archprint': patch
---

Scanning now skips everything git ignores, not just the root `.gitignore`: nested `.gitignore` files in subdirectories and repo-local `.git/info/exclude` are honored too. This keeps generated, vendored, and locally excluded directories out of the analysis, so a scan of a monorepo root is both faster and matches what you would expect git to track. Machine-global excludes are intentionally not read, so the same repository scans identically across machines.
