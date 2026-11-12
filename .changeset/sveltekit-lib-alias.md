---
'archprint': patch
---

archprint now resolves SvelteKit's `$lib` and `kit.alias` imports in a fresh checkout. SvelteKit defines them in a generated `.svelte-kit/tsconfig.json` that is not committed, so imports such as `$lib/server/counter` were unresolved: the orphan list reported the files they import, and rules did not see those edges. In a project that declares `@sveltejs/kit`, archprint reads `kit.files.lib` (`src/lib` by default) and the string entries of `kit.alias` from `svelte.config` without running it; an alias the tsconfig maps itself still wins. SvelteKit's own modules, `$app/...`, `$env/...` and `$service-worker`, no longer count as undeclared packages in the phantom-dependency check or its generated ESLint rule.
