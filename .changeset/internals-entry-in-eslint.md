---
'archprint': minor
---

Package internals and entry purity can now be enforced with plain ESLint too. When your repo does not use dependency-cruiser, `generate --include-structural` writes `archprint/no-dependency-internals` (importing a package's `src` or `internal` folders) and `archprint/no-import-framework-entry` (importing a page, layout or route handler from other code) into `.archprint/eslint.mjs`. Both pass on the code they were generated from and are adopted, so `archprint check` reports a new break and `archprint allow` accepts one. The entry rule recognizes pages and routes by their path, so new routes are covered without regenerating.

Fixes: the entry-purity rule written for dependency-cruiser flagged a page importing another page, test files, and the imports that already existed when it was generated; it now exempts all three. Package-internals evidence no longer counts `#` subpath imports or `scheme:` specifiers as packages.
