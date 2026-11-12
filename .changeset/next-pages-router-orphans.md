---
'archprint': patch
---

`scan` no longer lists Next.js pages-router pages as orphans. A file under `pages/` or `src/pages/` of a project that declares `next` (in its package.json or its workspace root's) or has a `next.config.*` is a route Next.js loads by its path, so nothing needs to import it. Before, only `pages/api`, `_app`, `_document` and `index` files were recognised, and every other page nothing imported was reported as dead code. A `pages/` folder in an app without Next.js is still checked.
