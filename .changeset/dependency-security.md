---
'archprint': patch
---

Dependency updates that close every open security advisory in archprint's dependencies: `minimatch` 11 (whose earlier versions could be slowed by a crafted glob), and patched versions of the MCP server's dependencies (`hono`, `@hono/node-server`, `body-parser`, `qs`, `fast-uri`, `ip-address`, `zod`). Generated rules compile globs with `picomatch` and match the same files as before.
