---
'archprint': patch
---

`scan` now counts imports from JavaScript files (`.js`, `.jsx`, `.mjs`, `.cjs`), `.mts` and `.cts` files, and Astro components (the frontmatter and `<script>` blocks) when it lists orphan modules. A file that only one of these imports is no longer listed as an orphan, and one that only such a test imports (`*.test.js`, `*.test.mts`) is listed as test-only. These files are never listed themselves.
