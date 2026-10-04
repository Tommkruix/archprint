---
'archprint': patch
---

The same repository now gives the same output on every machine. archprint reads files in name order instead of the order the filesystem returns them, which differs between macOS and Linux, so an example exception or a generated fixture no longer changes between a laptop and CI.
