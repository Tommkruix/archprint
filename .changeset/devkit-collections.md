---
'archprint': patch
---

The dead-code lists no longer report the generators, executors, builders, schematics and migrations of an Nx or Angular plugin. A package's devkit collections (`generators.json`, `executors.json`, `collection.json`, `migrations.json`, as its package.json names them) are now read, and each `factory` or `implementation` they name counts as used. A package entry built through any of its tsconfigs (such as `tsconfig.lib.json`, Nx's convention), not only `tsconfig.json` and `tsconfig.build.json`, now counts for the source file it was built from.
