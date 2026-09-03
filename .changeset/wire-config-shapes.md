---
'archprint': minor
---

`wire` now edits the common `export default tseslint.config(...)` and `export default defineConfig([...])`
flat-config shapes, not just a bare `export default [` array (dogfood finding). It inserts the managed spread as
the first config, keeping the file's formatting, and `eject` restores it exactly. Config shapes it still cannot
parse fall back to the printed snippet as before. Proven end-to-end: wiring archprint's own `tseslint.config()`
eslint config and running the real eslint engine fires the generated `no-console` rule.
