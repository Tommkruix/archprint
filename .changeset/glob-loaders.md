---
'archprint': patch
---

The orphan and test-only lists now follow files a bundler loads by pattern. A file matched by an `import.meta.glob` call (Vite), written as a literal pattern or a list of them, or found by a `require.context` call (webpack) with a literal folder, counts as referenced by the file that makes the call. Files a `!` pattern matches are excluded, relative patterns start at a literal `base` option when there is one, a `require.context` follows its recursion flag and filter, and a pattern starting with `/` starts at the nearest folder with a Vite config, else with a package.json. Before, such files were listed as orphans. A pattern built at run time is still not followed.
