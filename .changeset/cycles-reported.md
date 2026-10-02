---
'archprint': patch
---

`archprint init` and `archprint recommend` no longer list circular dependencies under "Enforcing now". Archprint does not write a lint rule for cycles, so nothing was enforcing them. They now appear under a new "Report only" group, which is also recorded as `reportOnly` in `.archprint/config.json`, in `recommend --json`, in the MCP `archprint_recommend` result, and in the README section `init` writes.
