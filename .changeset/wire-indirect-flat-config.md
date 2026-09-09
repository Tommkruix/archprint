---
'archprint': patch
---

`archprint wire` now edits the common config shape where the ESLint flat config is bound to a name
and exported by reference (`const config = [...]; export default config;`, the default for Next.js and
many TypeScript projects) instead of falling back to a manual edit. It resolves the exported name to
its declaration, including a `defineConfig([...])` wrapper, and `archprint eject` reverses it as before.
