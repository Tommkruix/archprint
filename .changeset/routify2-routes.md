---
'archprint': patch
---

The dead-code lists no longer report Routify 2 pages. In a project that declares `@roxi/routify` 2.x, the `.svelte` pages Routify routes under `src/pages` (or the `pages` folder its settings name) count as used, as Routify's own file tree does: not files in a folder whose name starts with `_`, nor files named with `_` other than layouts, resets, folder modules and fallbacks. A project that sets these options in code, sets an `ignore` glob, or sets a `ROUTIFY_` variable in `.env` is left as it was.
