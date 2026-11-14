---
'archprint': patch
---

`scan` no longer lists SvelteKit route files as orphans. In a SvelteKit project, the files SvelteKit loads from their default locations count as entries: `+page.svelte`, `+layout.svelte`, `+error.svelte` and the other `+` route files under `src/routes/` (layout resets such as `+page@.svelte` included), the hooks files, the param matchers (`src/params/*` in SvelteKit 2, `src/params` in SvelteKit 3), the service worker and `src/instrumentation.server`. Before, every route page nothing imported was reported as dead code. Other files in a route folder are still checked, and so is a `src/routes/` folder in a project without SvelteKit. archprint now also recognises a SvelteKit project without a `svelte.config`, such as every SvelteKit 3 project, by its Vite config importing `@sveltejs/kit/vite`: it gets `$lib` as `src/lib`, and its `$app/...` and `$env/...` imports no longer count as undeclared packages.
