---
'archprint': patch
---

Read a folder whose only TypeScript configs are named variants, such as `tsconfig.web.json` and `tsconfig.native.json`, or `tsconfig.oss.json` that a setup script copies to `tsconfig.json`. Before, archprint needed a `tsconfig.json`: `scan` and `init` stopped with "No tsconfig.json", and the orphan list, test-only list and your written rules saw none of the folder's path aliases, so a file reached only through one was listed as an orphan. archprint now keeps the aliases the variants agree on and leaves out one they map differently. A folder with a `tsconfig.json` or `tsconfig.base.json`, or one below such a folder, is read as before.
